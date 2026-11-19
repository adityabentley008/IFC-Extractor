import { Angle, Matrix3d, Point3d, Transform, Vector3d } from "@itwin/core-geometry";

export function inchesToMetres(value: number): number {
    return value / 39.3701;
}

function toSpatial(point: Point3d): Point3d {
    return Point3d.create(point.x, -point.z, point.y);
}

function toYUp(point: Point3d): Point3d {
    return Point3d.create(point.x, point.z, -point.y);
}

// Preserve the legacy connector's profile frame, including its rounded direction
// component and transform order, without importing the connector or its SDK.
export function alignProfileVertices(vertices: Point3d[], start: Point3d, end: Point3d, betaAngle: number): Point3d[] {
    const originalBeta = betaAngle;
    betaAngle = -betaAngle - 90;
    if (start.z > end.z) [start, end] = [end, start];
    start = toYUp(start);
    end = toYUp(end);

    const extrusion = Vector3d.createStartEnd(start, end);
    extrusion.normalizeInPlace();
    extrusion.y = Math.round(extrusion.y);
    const unit = Point3d.create(extrusion.x, extrusion.y, extrusion.z);
    const extrudedPoint = Point3d.create(10 * unit.x, 10 * unit.y, 10 * unit.z);
    const spatialExtrudedPoint = toSpatial(extrudedPoint);
    const spatialOrigin = toSpatial(start);

    const vertical = unit.x === 0 && Math.abs(unit.y) === 1 && unit.z === 0;
    if (vertical) {
        const rotation = Matrix3d.createRotationAroundVector(Vector3d.unitZ(), Angle.createDegrees(originalBeta));
        const transform = Transform.createFixedPointAndMatrix(spatialOrigin, rotation!);
        transform.origin.set(spatialOrigin.x, spatialOrigin.y, spatialOrigin.z);
        return vertices.map((vertex) => toYUp(transform.multiplyPoint3d(toSpatial(vertex))));
    }

    const xyPoint = Point3d.create(spatialExtrudedPoint.x, spatialExtrudedPoint.y, 0);
    const origin = Point3d.create(0, 0, 0);
    const xyDirection = Vector3d.createNormalizedStartEnd(origin, xyPoint)!;
    const perpendicular = xyDirection.unitPerpendicularXY();
    const perpendicularStart = Point3d.create(10 * perpendicular.x, 10 * perpendicular.y, 10 * perpendicular.z);
    const perpendicularEnd = Point3d.create(-10 * perpendicular.x, -10 * perpendicular.y, -10 * perpendicular.z);
    const rotationAxis = Vector3d.createNormalizedStartEnd(perpendicularStart, perpendicularEnd)!;
    let angleWithX = xyDirection.angleTo(Vector3d.unitX()).degrees;
    const extrudedDirection = Vector3d.createStartEnd(origin, spatialExtrudedPoint);
    let angleWithXY = xyDirection.angleTo(extrudedDirection).degrees;
    const spatialVertices = vertices.map((vertex) => toSpatial(vertex));
    if (xyDirection.y < 0) angleWithX *= -1;
    if (spatialExtrudedPoint.z < 0) angleWithXY *= -1;

    const matrix0 = Matrix3d.createRotationAroundVector(Vector3d.unitZ(), Angle.createDegrees(betaAngle));
    const matrix1 = Matrix3d.createRotationAroundVector(Vector3d.unitY(), Angle.createDegrees(-90));
    const matrix2 = Matrix3d.createRotationAroundVector(Vector3d.unitZ(), Angle.createDegrees(angleWithX));
    const matrix3 = Matrix3d.createRotationAroundVector(rotationAxis, Angle.createDegrees(angleWithXY));
    const rotation0 = Transform.createFixedPointAndMatrix(origin, matrix0!);
    const rotation1 = Transform.createFixedPointAndMatrix(origin, matrix1!);
    const rotation2 = Transform.createFixedPointAndMatrix(origin, matrix2!);
    const rotation3 = Transform.createFixedPointAndMatrix(spatialOrigin, matrix3!);
    rotation3.origin.set(spatialOrigin.x, spatialOrigin.y, spatialOrigin.z);
    return spatialVertices.map((vertex) => {
        const rotated0 = rotation0.multiplyPoint3d(vertex);
        const rotated1 = rotation1.multiplyPoint3d(rotated0);
        const rotated2 = rotation2.multiplyPoint3d(rotated1);
        const rotated3 = rotation3.multiplyPoint3d(rotated2);
        return toYUp(rotated3);
    });
}
