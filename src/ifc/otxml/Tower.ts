import { Element } from "xml-js";
import { IfcModel } from "../IfcModel";
import { IfcEntity, Properties } from "../IfcTypes";
import { finite, references } from "../StepParser";
import { element } from "./Xml";

interface TowerData {
    entity: IfcEntity;
    convention: string;
    declaredPanels: number;
    panels: IfcEntity[];
    beams: IfcEntity[];
}

export function readTower(model: IfcModel, allowPartial = false): TowerData {
    const towers = model.components("TowerInformation");
    if (towers.length !== 1) throw new Error("Expected exactly one OpenTower tower.");
    const tower = towers[0];
    const convention = model.required(tower.id, "Tower Convention");
    // if (model.required(tower.id, "Tower Type") !== "SelfSupported" || !["MS TOWER", "OpenTower"].includes(convention)) {
    //     throw new Error("Only MS TOWER and OpenTower SelfSupported panel exports are supported.");
    // }
    validateProjectUnits(model);
    const panels = model.components("Panel").sort((a, b) =>
        finite(model.required(a.id, "PanelID"), "PanelID") - finite(model.required(b.id, "PanelID"), "PanelID"));
    const declaredPanels = finite(model.required(tower.id, "No. of Panels"), "panel count");
    if (!Number.isInteger(declaredPanels) || declaredPanels < 1 || !panels.length || panels.length > declaredPanels ||
        (panels.length !== declaredPanels && !allowPartial)) {
        throw new Error(`Tower declares ${declaredPanels} panels but exports ${panels.length}. Use --allow-partial only to convert an incomplete export.`);
    }
    validatePanels(model, tower, panels, declaredPanels);
    const beams = model.entitiesOfType("IFCBEAM");
    for (const beam of beams) {
        if (!["Leg", "TowerMember"].includes(model.required(beam.id, "ComponentName")) ||
            model.ancestry(beam.id).filter((id) => panels.some((panel) => panel.id === id)).length !== 1) {
            throw new Error(`Unsupported or unparented beam #${beam.id}.`);
        }
    }
    return { entity: tower, convention, declaredPanels, panels, beams };
}

function validateProjectUnits(model: IfcModel): void {
    const projects = model.entitiesOfType("IFCPROJECT");
    if (projects.length !== 1) throw new Error("Expected one IFC project.");
    const units = model.getEntity(references(projects[0].args[8])[0], "IFCUNITASSIGNMENT");
    const lengthUnits = references(units.args[0]).map((id) => model.getEntity(id))
        .filter((entity) => entity.args[1] === ".LENGTHUNIT.");
    if (lengthUnits.length !== 1 || lengthUnits[0].type !== "IFCSIUNIT" ||
        lengthUnits[0].args[2] !== "$" || lengthUnits[0].args[3] !== ".METRE.") {
        throw new Error("IFC project length unit must be metres.");
    }
}

function validatePanels(model: IfcModel, tower: IfcEntity, panels: IfcEntity[], declaredPanels: number): void {
    const panelIds = new Set<number>();
    for (const [index, panel] of panels.entries()) {
        const id = finite(model.required(panel.id, "PanelID"), "PanelID");
        if (!Number.isInteger(id) || id < 1 || id > declaredPanels || panelIds.has(id) || !model.ancestry(panel.id).includes(tower.id)) {
            throw new Error(`Invalid panel ID or hierarchy at #${panel.id}.`);
        }
        if (id !== index + 1) throw new Error("Exported panels must be consecutive starting at Panel 1; the connector reader renumbers panels.");
        panelIds.add(id);
        for (const key of ["Plan Bracing of Panel", "Hip Bracing of Panel"]) {
            if (model.required(panel.id, key) !== "None") throw new Error(`Unsupported ${key} at #${panel.id}.`);
        }
    }
}

export function conversionWarnings(tower: TowerData): string[] {
    const warnings = [
        "Only tower panels and their members are converted; supports, mounts, equipment and helper geometry are excluded.",
        "Endpoint properties are rounded by IFC export; byte-identical geometry and original source IDs cannot be recovered.",
        "Panel dimensions remain in exported feet; endpoint coordinates remain Y-up metres; recovered profile dimensions use connector inches.",
        "Section geometry is recovered from IFC member meshes. Material engineering properties use generic steel defaults, not analysis-certified values.",
    ];
    if (tower.panels.length !== tower.declaredPanels) {
        warnings.push(`PARTIAL EXPORT: IFC declares ${tower.declaredPanels} panels but contains ${tower.panels.length}; ${tower.declaredPanels - tower.panels.length} panels are missing. Only exported panels are converted; tower height still describes the source tower.`);
    }
    if (tower.convention === "OpenTower") {
        warnings.push("OpenTower parametric circular and L-shape members are recovered without PolyLine contours to retain the connector's original rendering path. Solid circular meshes do not establish an engineering wall thickness.");
    }
    return warnings;
}

export function buildTowerInformation(model: IfcModel, tower: TowerData): Element {
    const towerMap: Properties = {
        TowerName: "Tower Name", Convention: "Tower Convention", BearingAngle: "Bearing Angle/ North Orientation",
        TowerType: "Tower Type", TowerHeight: "Height of Tower", TopFaceWidth: "Top Face Width (ft)",
        TopFaceDepth: "Top Face Depth (ft)", BottomFaceWidth: "Bottom Face Width (ft)",
        BottomFaceDepth: "Bottom Face Depth (ft)", NoofPanel: "No. of Panels", NoOfLegs: "No. of Legs",
        OTXMLAngle: "OTXMLAngle", Orientation: "Orientation", UnitSystem: "Unit System",
    };
    const id = tower.entity.id;
    const attributes: Properties = { TowerID: model.required(id, "Tower ID"), ComponentName: "TowerInformation", SourceAppElementId: "TowerInformation_1" };
    for (const [target, source] of Object.entries(towerMap)) attributes[target] = model.required(id, source);
    for (const key of ["TowerShape", "ConcreteHeight"]) {
        const value = model.property(id, key);
        if (value !== undefined) attributes[key] = value;
    }
    for (const [target, source] of Object.entries({ TowerTiltX: "Tower Tilt X", TowerTiltY: "Tower Tilt Y" })) {
        const value = model.property(id, source);
        if (value !== undefined) {
            finite(value, source);
            attributes[target] = value;
        }
    }
    if (tower.panels.length !== tower.declaredPanels) {
        attributes.NoofPanel = String(tower.panels.length);
        attributes.SourcePanelCount = String(tower.declaredPanels);
        attributes.PartialExport = "True";
    }
    return element("TowerInformation", attributes);
}

export function buildProjectData(model: IfcModel): Element {
    const sites = model.entitiesOfType("IFCSITE");
    if (sites.length !== 1) throw new Error("Expected one IFC site with Site_Data geolocation.");
    const attributes: Properties = { ID: "1", ComponentName: "ProjectData", SourceAppElementId: "ProjectData_1" };
    for (const [target, source] of Object.entries({
        Site_Lattitude: "Latitude", Site_Longitude: "Longitude", Site_Altitude: "Altitude",
    })) {
        attributes[target] = model.required(sites[0].id, source);
        finite(attributes[target], source);
    }
    return element("ProjectData", attributes);
}
