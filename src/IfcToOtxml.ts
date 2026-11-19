import { IfcModel } from "./ifc/IfcModel";
import { buildPanel } from "./ifc/otxml/Panel";
import { PhysicalMemberBuilder } from "./ifc/otxml/PhysicalMember";
import { buildProjectData, buildTowerInformation, conversionWarnings, readTower } from "./ifc/otxml/Tower";
import { element, writeOtxml } from "./ifc/otxml/Xml";
export { convertIfcToCommonData } from "./IfcToCommonData";
export type { IfcToCommonDataResult } from "./IfcToCommonData";

export interface IfcToOtxmlResult {
    xml: string;
    warnings: string[];
    counts: { panels: number; legs: number; bracingMembers: number; nodes: number };
}

/**
 * Converts Bentley OpenTower IFC2X3 SST panel metadata and supported member mesh profiles.
 * The exported endpoint properties are already OTXML Y-up coordinates in metres.
 */
export function convertIfcToOtxml(ifc: string, options: { allowPartial?: boolean } = {}): IfcToOtxmlResult {
    const model = new IfcModel(ifc);
    const tower = readTower(model, options.allowPartial);
    const warnings = conversionWarnings(tower);
    const members = new PhysicalMemberBuilder(model, tower.convention, tower.beams, warnings);
    const panels = tower.panels.map((panel) => buildPanel(model, members, panel, tower.entity));
    members.finish();
    const towerInformation = buildTowerInformation(model, tower);
    const projectData = buildProjectData(model);

    return {
        xml: writeOtxml([
            element("Sections", {}, members.sections.elements),
            element("Materials", {}, members.materials.elements),
            element("Nodes", {}, members.nodes.elements),
            element("PanelProperties", {}, panels.map((panel) => panel.property)),
            ...panels.map((panel) => panel.panel),
            projectData,
            towerInformation,
        ]),
        warnings,
        counts: {
            panels: panels.length,
            legs: model.components("Leg").length,
            bracingMembers: model.components("TowerMember").length,
            nodes: members.nodes.elements.length,
        },
    };
}
