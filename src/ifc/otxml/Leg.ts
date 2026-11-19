import { Element } from "xml-js";
import { IfcModel } from "../IfcModel";
import { IfcEntity } from "../IfcTypes";
import { PhysicalMemberBuilder } from "./PhysicalMember";
import { element } from "./Xml";

export function buildLeg(model: IfcModel, members: PhysicalMemberBuilder, leg: IfcEntity, panelId: string): Element {
    return element("Leg", { Name: model.required(leg.id, "Leg Name") }, [
        members.build(leg, panelId),
    ]);
}
