import { Matrix3d, Point3d, Transform, Vector3d } from "@itwin/core-geometry";
import { alignProfileVertices, inchesToMetres } from "./LegacyProfileMath";
import { EntityGetter, IfcEntity, ProfileShape, Properties } from "../IfcTypes";
import { finite } from "../StepParser";
import { inverseTransform, readMemberFaces } from "./MemberGeometry";
import { UnsupportedProfile } from "./UnsupportedProfile";

const tolerance = 1e-8;

interface RecoveredProfile {
    dimensions: Properties;
    contour: Point3d[];
}

export function spatialEndpoint(raw: string): Point3d {
    const values = raw.split(",");
    if (values.length !== 3) throw new Error(`Invalid endpoint: ${raw}`);
    const [x, y, z] = values.map((value) => finite(value, "endpoint"));
    return Point3d.create(x, -z, y);
}

export function recoverProfile(beam: IfcEntity, get: EntityGetter, start: Point3d, end: Point3d, beta: number,
    shape: ProfileShape, parametric = false): RecoveredProfile {
    const faces = readMemberFaces(beam, get);
    if (end.z < start.z) [start, end] = [end, start];
    if (start.distance(end) < tolerance) throw new Error(`Zero-length member #${beam.id}.`);
    const frame = parametric
        ? createParametricFrame(faces, start, end, beam.id)
        : createContourFrame(start, end, beta);
    const localFaces = faces.map((face) => face.map((p) => frame.multiplyPoint3d(p)));
    const levels = localFaces.reduce<number[]>((values, face) => values.concat(face.map((p) => p.z)), []);
    const bottom = Math.min(...levels);
    const top = Math.max(...levels);
    if (!Number.isFinite(bottom) || top - bottom < tolerance) throw new UnsupportedProfile(`Missing extruded section geometry on #${beam.id}.`);
    if (parametric) validateConstantSection(localFaces, bottom, top, beam.id);
    const capFaces = localFaces.filter((face) => face.every((p) => Math.abs(p.z - bottom) < tolerance));
    const loops = traceCapBoundaries(capFaces, beam.id);
    if (parametric) return { dimensions: measureParametricProfile(loops, shape, beam.id), contour: [] };
    return { dimensions: measureContourProfile(loops, shape, beam.id), contour: loops[0] };
}

function createParametricFrame(faces: Point3d[][], start: Point3d, end: Point3d, beamId: number): Transform {
    const axis = start.vectorTo(end).normalize()!;
    let capNormal: Vector3d | undefined;
    let origin: Point3d | undefined;
    for (const face of faces) {
        for (let i = 2; i < face.length; i++) {
            const normal = face[0].vectorTo(face[1]).crossProduct(face[0].vectorTo(face[i])).normalize();
            if (normal && Math.abs(normal.dotProduct(axis)) > 0.9999) {
                capNormal = normal.dotProduct(axis) < 0 ? normal.scale(-1) : normal;
                origin = face[0];
                break;
            }
        }
        if (capNormal) break;
    }
    if (!capNormal || !origin) throw new UnsupportedProfile(`Missing parametric member cap on #${beamId}.`);
    const x = capNormal.crossProduct(Vector3d.unitZ()).normalize() || Vector3d.unitX();
    return inverseTransform(Transform.createOriginAndMatrix(origin, Matrix3d.createColumns(x, capNormal.crossProduct(x), capNormal)));
}

function createContourFrame(start: Point3d, end: Point3d, beta: number): Transform {
    // Invert the connector's actual profile frame, including its non-orthogonal extrusion convention.
    const basis = alignProfileVertices([
        Point3d.createZero(), Point3d.create(1, 0, 0), Point3d.create(0, 0, 1),
    ], start, end, beta).map((p) => Point3d.create(p.x, -p.z, p.y));
    return inverseTransform(Transform.createOriginAndMatrix(basis[0], Matrix3d.createColumns(
        basis[0].vectorTo(basis[1]), basis[0].vectorTo(basis[2]), start.vectorTo(end),
    )));
}

function validateConstantSection(faces: Point3d[][], bottom: number, top: number, beamId: number): void {
    const points = faces.reduce<Point3d[]>((values, face) => values.concat(face), []);
    const lower = points.filter((p) => Math.abs(p.z - bottom) < tolerance);
    const upper = points.filter((p) => Math.abs(p.z - top) < tolerance);
    const matches = (p: Point3d, candidates: Point3d[]): boolean =>
        candidates.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < tolerance);
    if (lower.length + upper.length !== points.length ||
        lower.some((p) => !matches(p, upper)) || upper.some((p) => !matches(p, lower))) {
        throw new UnsupportedProfile(`Expected a straight constant-section parametric member on #${beamId}.`);
    }
}

function signedArea(points: Point3d[]): number {
    return points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + p.x * q.z - q.x * p.z;
    }, 0) / 2;
}

function traceCapBoundaries(capFaces: Point3d[][], beamId: number): Point3d[][] {
    const vertices = new Map<string, Point3d>();
    const edges = new Map<string, { a: string; b: string; count: number }>();
    const vertexKey = (p: Point3d): string => {
        const id = `${Math.round(p.x / tolerance)},${Math.round(p.y / tolerance)}`;
        if (!vertices.has(id)) vertices.set(id, Point3d.create(p.x, 0, p.y));
        return id;
    };
    for (const face of capFaces) {
        for (let i = 0; i < face.length; i++) {
            const a = vertexKey(face[i]);
            const b = vertexKey(face[(i + 1) % face.length]);
            if (a === b) continue;
            const edgeKey = [a, b].sort().join("|");
            const edge = edges.get(edgeKey);
            if (edge) edge.count++;
            else edges.set(edgeKey, { a, b, count: 1 });
        }
    }
    const neighbors = new Map<string, Set<string>>();
    for (const { a, b, count } of edges.values()) {
        // Triangulation edges and repeated cap seams cancel in pairs.
        if (count % 2 === 0) continue;
        if (!neighbors.has(a)) neighbors.set(a, new Set());
        if (!neighbors.has(b)) neighbors.set(b, new Set());
        neighbors.get(a)!.add(b);
        neighbors.get(b)!.add(a);
    }
    if (!neighbors.size || [...neighbors.values()].some((n) => n.size !== 2)) {
        throw new UnsupportedProfile(`Cannot recover closed section contours from IFC beam #${beamId}.`);
    }
    const remaining = new Set(neighbors.keys());
    const loops: Point3d[][] = [];
    while (remaining.size) {
        const first = [...remaining][0];
        let current = first;
        let previous = "";
        const loop: Point3d[] = [];
        do {
            if (!remaining.delete(current)) throw new Error(`Non-simple section contour at #${beamId}.`);
            loop.push(vertices.get(current)!);
            const next = [...neighbors.get(current)!].find((n) => n !== previous)!;
            previous = current;
            current = next;
        } while (current !== first);
        if (loop.length < 3 || Math.abs(signedArea(loop)) < tolerance * tolerance) throw new Error(`Degenerate section contour at #${beamId}.`);
        if (signedArea(loop) < 0) loop.reverse();
        loops.push(loop);
    }
    loops.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
    return loops;
}

function inches(metres: number): string {
    return String(metres / inchesToMetres(1));
}

function measureParametricProfile(loops: Point3d[][], shape: ProfileShape, beamId: number): Properties {
    const contour = loops[0];
    if (loops.length !== 1) throw new Error(`Expected one solid parametric section contour on #${beamId}.`);
    if (shape === "HollowCircleProfile") {
        const cx = contour.reduce((sum, p) => sum + p.x, 0) / contour.length;
        const cz = contour.reduce((sum, p) => sum + p.z, 0) / contour.length;
        const radii = contour.map((p) => Math.hypot(p.x - cx, p.z - cz));
        const radius = radii.reduce((sum, r) => sum + r, 0) / radii.length;
        if (contour.length < 8 || radii.some((r) => Math.abs(r - radius) > tolerance)) {
            throw new Error(`Invalid solid circular section on #${beamId}.`);
        }
        return { Radius: inches(radius), WallThickness: "0" };
    }
    const edges = contour.map((p, i) => p.vectorTo(contour[(i + 1) % contour.length]));
    const lengths = edges.map((edge) => edge.magnitude()).sort((a, b) => a - b);
    const depth = lengths[lengths.length - 1];
    // The legacy renderer places the re-entrant corner at (-Thickness, Thickness).
    const thickness = depth / 2 - lengths[0];
    const expected = [depth / 2 - thickness, depth / 2 - thickness, depth / 2 + thickness, depth / 2 + thickness, depth, depth];
    if (contour.length !== 6 || thickness <= 0 || thickness >= depth / 2 ||
        lengths.some((length, i) => Math.abs(length - expected[i]) > tolerance) ||
        edges.some((edge, i) => Math.abs(edge.dotProduct(edges[(i + 1) % edges.length])) > tolerance * depth)) {
        throw new Error(`Unsupported parametric L-shape on #${beamId}.`);
    }
    return { Width: "0", Depth: inches(depth), Thickness: inches(thickness), FilletRadius: "0", EdgeRadius: "0" };
}

function measureContourProfile(loops: Point3d[][], shape: ProfileShape, beamId: number): Properties {
    const contour = loops[0];
    if (shape === "HollowCircleProfile") {
        if (loops.length !== 2) throw new Error(`Expected outer and inner hollow-circle contours on #${beamId}.`);
        const radius = (points: Point3d[]): number => points.reduce((sum, p) => sum + Math.hypot(p.x, p.z), 0) / points.length;
        const outer = radius(contour);
        const inner = radius(loops[1]);
        if (contour.some((p) => Math.abs(Math.hypot(p.x, p.z) - outer) > 1e-5) ||
            loops[1].some((p) => Math.abs(Math.hypot(p.x, p.z) - inner) > 1e-5) || inner <= 0 || outer <= inner) {
            throw new Error(`Invalid hollow-circle section on #${beamId}.`);
        }
        return { Radius: inches(outer), WallThickness: inches(outer - inner) };
    }
    if (loops.length !== 1 || contour.length !== 6) throw new Error(`Expected a six-vertex L-shape contour on #${beamId}.`);
    const width = Math.max(...contour.map((p) => p.x)) - Math.min(...contour.map((p) => p.x));
    const depth = Math.max(...contour.map((p) => p.z)) - Math.min(...contour.map((p) => p.z));
    const thickness = Math.min(...contour.map((p, i) => p.distance(contour[(i + 1) % contour.length])));
    return { Width: inches(width), Depth: inches(depth), Thickness: inches(thickness), FilletRadius: "0", EdgeRadius: "0" };
}
