import { Matrix3d, Point3d, Transform, Vector3d } from "@itwin/core-geometry";
import { EntityGetter, IfcEntity } from "../IfcTypes";
import { finite, references, splitStep, stepText } from "../StepParser";

export function inverseTransform(transform: Transform): Transform {
    const result = transform.inverse();
    if (!result) throw new Error("Singular IFC/profile transform.");
    return result;
}

export function readMemberFaces(beam: IfcEntity, get: EntityGetter): Point3d[][] {
    const readPoint = (raw: string, type = "IFCCARTESIANPOINT"): Point3d => {
        const entity = get(references(raw)[0], type);
        const values = splitStep(entity.args[0].slice(1, -1), ",").map((v) => finite(v, `#${entity.id}`));
        if (values.length !== 3) throw new Error(`Expected three coordinates at #${entity.id}.`);
        return Point3d.create(...values);
    };
    const readDirection = (raw: string, fallback: Vector3d): Vector3d => {
        if (raw === "$") return fallback;
        const p = readPoint(raw, "IFCDIRECTION");
        const unit = Vector3d.create(p.x, p.y, p.z).normalize();
        if (!unit) throw new Error("Invalid IFC direction.");
        return unit;
    };
    const readAxisPlacement = (raw: string): Transform => {
        const axis = get(references(raw)[0], "IFCAXIS2PLACEMENT3D");
        const z = readDirection(axis.args[1], Vector3d.unitZ());
        const y = z.crossProduct(readDirection(axis.args[2], Vector3d.unitX())).normalize();
        if (!y) throw new Error(`Invalid IFC placement #${axis.id}.`);
        return Transform.createOriginAndMatrix(readPoint(axis.args[0]), Matrix3d.createColumns(y.crossProduct(z), y, z));
    };
    const placements = new Set<number>();
    const readLocalPlacement = (raw: string): Transform => {
        if (raw === "$") return Transform.createIdentity();
        const placement = get(references(raw)[0], "IFCLOCALPLACEMENT");
        if (placements.has(placement.id)) throw new Error(`Cyclic IFC placement #${placement.id}.`);
        placements.add(placement.id);
        const result = readLocalPlacement(placement.args[0]).multiplyTransformTransform(readAxisPlacement(placement.args[1]));
        placements.delete(placement.id);
        return result;
    };
    const readMappingTarget = (raw: string): Transform => {
        const target = get(references(raw)[0]);
        if (!["IFCCARTESIANTRANSFORMATIONOPERATOR3D", "IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM"].includes(target.type)) {
            throw new Error(`Unsupported IFC mapping target #${target.id}.`);
        }
        const scale = (rawScale: string): number => {
            const value = finite(rawScale, "mapping scale");
            if (value <= 0) throw new Error("IFC mapping scale must be positive.");
            return value;
        };
        const s1 = target.args[3] === "$" ? 1 : scale(target.args[3]);
        const s2 = target.args[5] === undefined || target.args[5] === "$" ? s1 : scale(target.args[5]);
        const s3 = target.args[6] === undefined || target.args[6] === "$" ? s1 : scale(target.args[6]);
        return Transform.createOriginAndMatrix(readPoint(target.args[2]), Matrix3d.createColumns(
            readDirection(target.args[0], Vector3d.unitX()).scale(s1),
            readDirection(target.args[1], Vector3d.unitY()).scale(s2),
            readDirection(target.args[4], Vector3d.unitZ()).scale(s3),
        ));
    };
    const faces: Point3d[][] = [];
    const visiting = new Set<number>();
    const collectFaces = (id: number, transform: Transform): void => {
        if (visiting.has(id)) throw new Error(`Cyclic IFC representation #${id}.`);
        visiting.add(id);
        const entity = get(id);
        const a = entity.args;
        switch (entity.type) {
            case "IFCPRODUCTDEFINITIONSHAPE":
                for (const ref of references(a[2])) collectFaces(ref, transform);
                break;
            case "IFCSHAPEREPRESENTATION":
                if (stepText(a[1]) !== "Body") throw new Error(`Unsupported representation #${id}; expected Body.`);
                for (const ref of references(a[3])) collectFaces(ref, transform);
                break;
            case "IFCMAPPEDITEM": {
                const map = get(references(a[0])[0], "IFCREPRESENTATIONMAP");
                const mapped = readMappingTarget(a[1]).multiplyTransformTransform(inverseTransform(readAxisPlacement(map.args[0])));
                collectFaces(references(map.args[1])[0], transform.multiplyTransformTransform(mapped));
                break;
            }
            case "IFCFACETEDBREP": {
                const shell = get(references(a[0])[0], "IFCCLOSEDSHELL");
                for (const faceRef of references(shell.args[0])) {
                    const face = get(faceRef, "IFCFACE");
                    for (const boundRef of references(face.args[0])) {
                        const bound = get(boundRef);
                        if (!["IFCFACEOUTERBOUND", "IFCFACEBOUND"].includes(bound.type)) throw new Error(`Unsupported face bound #${boundRef}.`);
                        const loop = get(references(bound.args[0])[0], "IFCPOLYLOOP");
                        faces.push(references(loop.args[0]).map((ref) => transform.multiplyPoint3d(readPoint(`#${ref}`))));
                    }
                }
                break;
            }
            default:
                throw new Error(`Unsupported section geometry ${entity.type} at #${id}; expected mapped faceted BREP.`);
        }
        visiting.delete(id);
    };
    collectFaces(references(beam.args[6])[0], readLocalPlacement(beam.args[5]));
    return faces;
}
