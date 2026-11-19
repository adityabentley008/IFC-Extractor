import { Element } from "xml-js";
import { IfcModel } from "../IfcModel";
import { IfcEntity } from "../IfcTypes";
import { PhysicalMemberBuilder } from "./PhysicalMember";
import { element } from "./Xml";

export function buildSegment(model: IfcModel, members: PhysicalMemberBuilder, segment: IfcEntity, index: number, panelId: string): Element {
    const beams = model.children(segment.id, "TowerMember");
    return element("Segment", { ID: String(index + 1), Name: model.required(segment.id, "Name") },
        beams.map((beam) => members.build(beam, panelId)));
}
