import { Element } from "xml-js";
import { IfcModel } from "../IfcModel";
import { IfcEntity, Properties } from "../IfcTypes";
import { finite, stepText } from "../StepParser";
import { buildFace } from "./Face";
import { buildLeg } from "./Leg";
import { PhysicalMemberBuilder } from "./PhysicalMember";
import { element } from "./Xml";

const panelPropertyMap: Properties = {
    Height: "Height of Panel", TopWidth: "Top Width of Panel", BottomWidth: "Bottom  Width of Panel",
    TopElevation: "Top Elevation of Panel", BottomElevation: "Bottom Elevation of Panel",
    FaceBracing: "Face Bracing of Panel", PlanBracing: "Plan Bracing of Panel",
    HipBracing: "Hip Bracing of Panel", NumberOfSegments: "Number Of Segments in Panel", Weight: "Weight of Panel",
};

export function buildPanel(model: IfcModel, members: PhysicalMemberBuilder, panel: IfcEntity, tower: IfcEntity):
    { property: Element; panel: Element } {
    const id = model.required(panel.id, "PanelID");
    const attributes = readPanelProperties(model, panel, id);
    const legs = model.children(panel.id, "Leg");
    if (legs.length !== finite(model.required(tower.id, "No. of Legs"), "leg count")) {
        throw new Error(`Leg count mismatch in panel ${id}.`);
    }
    const legNames = legs.map((leg) => model.required(leg.id, "Leg Name"));
    if (new Set(legNames).size !== legNames.length) throw new Error(`Duplicate leg name in panel ${id}.`);
    const faceBracing = model.children(panel.id, "FaceBracing");
    if (faceBracing.length !== 1) throw new Error(`Expected one FaceBracing group in panel ${id}.`);
    const faces = model.children(faceBracing[0].id, "Face");
    const faceNames = faces.map((face) => model.required(face.id, "FaceName"));
    if (faces.length !== legs.length || new Set(faceNames).size !== faces.length) {
        throw new Error(`Invalid face hierarchy in panel ${id}.`);
    }
    return {
        property: element("PanelProperty", attributes),
        panel: element("Panel", { ID: id }, [
            element("Legs", {}, legs.map((leg) => buildLeg(model, members, leg, id))),
            element("FaceBracingDetails", {}, faces.map((face, index) =>
                buildFace(model, members, face, index, id, Number(attributes.NumberOfSegments)))),
            element("PlanBracingDetails"), element("HipBracingDetails"),
        ]),
    };
}

function readPanelProperties(model: IfcModel, panel: IfcEntity, id: string): Properties {
    const attributes: Properties = { PanelID: id, Label: stepText(panel.args[2]), ComponentName: "Panel", SourceAppElementId: `Panel_${id}` };
    for (const [target, source] of Object.entries(panelPropertyMap)) attributes[target] = model.required(panel.id, source);
    for (const key of ["Height", "TopWidth", "BottomWidth", "TopElevation", "BottomElevation", "NumberOfSegments", "Weight"]) {
        finite(attributes[key], `Panel ${id}.${key}`);
    }
    return attributes;
}
