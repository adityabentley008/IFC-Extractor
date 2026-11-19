import { Element } from "xml-js";
import { IfcModel } from "../IfcModel";
import { IfcEntity } from "../IfcTypes";
import { PhysicalMemberBuilder } from "./PhysicalMember";
import { buildSegment } from "./Segment";
import { element } from "./Xml";

export function buildFace(model: IfcModel, members: PhysicalMemberBuilder, face: IfcEntity, index: number,
    panelId: string, expectedSegments: number): Element {
    const segments = model.children(face.id, "Segment");
    if (segments.length !== expectedSegments) throw new Error(`Segment count mismatch at #${face.id}.`);
    return element("Face", { ID: String(index + 1), Name: model.required(face.id, "FaceName") }, [
        element("Segments", {}, segments.map((segment, segmentIndex) => buildSegment(model, members, segment, segmentIndex, panelId))),
    ]);
}
