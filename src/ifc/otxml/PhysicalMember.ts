import { Element } from "xml-js";
import { IfcModel } from "../IfcModel";
import { IfcEntity, Properties } from "../IfcTypes";
import { finite, stepText } from "../StepParser";
import { Materials } from "./Materials";
import { Nodes } from "./Nodes";
import { Sections } from "./Sections";
import { element } from "./Xml";
import { Member } from "../../CommonData";
import { UnsupportedProfile } from "../geometry/UnsupportedProfile";

export class PhysicalMemberBuilder {
    public readonly nodes = new Nodes();
    public readonly materials = new Materials();
    public readonly sections: Sections;
    private readonly consumed = new Set<number>();
    private missingMaterials = 0;
    private shortReleases = 0;

    constructor(private readonly model: IfcModel, convention: string,
        private readonly beams: IfcEntity[], private readonly warnings: string[], includeContours = true) {
        this.sections = new Sections(model, convention, beams, warnings, includeContours);
    }

    public build(beam: IfcEntity, panelId: string): Element {
        return element("PhysicalMember", this.buildData(beam, panelId).sourceAttributes);
    }

    public buildData(beam: IfcEntity, panelId: string, extract = false): Member {
        if (this.consumed.has(beam.id)) throw new Error(`Beam #${beam.id} was emitted twice.`);
        this.consumed.add(beam.id);
        const sectionName = this.model.property(beam.id, "Section Name") || this.model.property(beam.id, "Section");
        const issues: string[] = [];
        const required = (key: string) => {
            const value = this.model.property(beam.id, key);
            if (!value) {
                if (!extract) return this.model.required(beam.id, key);
                issues.push(`Missing ${key} on #${beam.id}.`);
            }
            return value || undefined;
        };
        let material = this.model.property(beam.id, "Material Name");
        const materialAssignmentSource = material ? "exported" : "assumed";
        if (!material) {
            material = "Default Steel";
            this.missingMaterials++;
        }
        const startPoint = required("StartPoint");
        const endPoint = required("EndPoint");
        const start = startPoint === undefined ? undefined : this.nodes.resolve(startPoint);
        const end = endPoint === undefined ? undefined : this.nodes.resolve(endPoint);
        if (start !== undefined && start === end) throw new Error(`Zero-length member #${beam.id}.`);
        let sectionId: string | undefined;
        const beta = required("BetaAngle");
        if (!sectionName) {
            if (!extract) throw new Error(`Missing section on #${beam.id}.`);
            issues.push(`Missing section on #${beam.id}.`);
        } else if (start && end && beta !== undefined) {
            try {
                sectionId = this.sections.resolve(sectionName, beam);
            } catch (error) {
                if (!extract || !(error instanceof UnsupportedProfile)) throw error;
                issues.push(error.message);
            }
        } else {
            issues.push(`Cannot recover section ${sectionName} without endpoints and beta angle.`);
        }
        const startRelease = required("StartRelease");
        const endRelease = required("EndRelease");
        for (const release of [startRelease, endRelease]) {
            if (release !== undefined && !/^[01]{5,6}$/.test(release)) {
                if (!extract) throw new Error(`Unsupported member release on #${beam.id}.`);
                issues.push(`Unsupported member release on #${beam.id}.`);
                break;
            }
        }
        if (startRelease?.length === 5 || endRelease?.length === 5) this.shortReleases++;
        const label = beam.args[2] && beam.args[2] !== "$" ? stepText(beam.args[2]) :
            this.model.property(beam.id, "User Label") || this.model.property(beam.id, "ComponentName") || beam.type;
        const attributes: Properties = {
            ...(panelId ? { PanelPropertyID: panelId } : {}), ID: String(beam.id),
            ...(start === undefined ? {} : { StartNodeID: start }),
            ...(end === undefined ? {} : { EndNodeID: end }),
            ...(sectionId === undefined ? {} : { SectionID: sectionId }),
            MaterialID: this.materials.resolve(material),
            ...(beta === undefined ? {} : { BetaAngle: beta }), Label: label,
            SourceAppElementId: `IFC_${stepText(beam.args[0])}`,
            ...(startRelease === undefined ? {} : { StartRelease: startRelease }),
            ...(endRelease === undefined ? {} : { EndRelease: endRelease }),
        };
        const memberTag = this.model.property(beam.id, "MemberTag");
        if (memberTag) attributes.MemberTag = memberTag;
        const result: Member = {
            id: attributes.ID, startNodeId: start, endNodeId: end, sectionId: attributes.SectionID,
            materialId: attributes.MaterialID, materialAssignmentSource,
            betaAngleDegrees: beta === undefined ? undefined : finite(beta, "BetaAngle"), label: attributes.Label,
            sourceElementId: attributes.SourceAppElementId, startRelease: attributes.StartRelease,
            endRelease: attributes.EndRelease, sourceAttributes: attributes,
        };
        if (issues.length) result.extractionIssues = issues;
        if (memberTag) result.tag = memberTag;
        return result;
    }

    public finish(requireAllBeams = true): void {
        if (requireAllBeams && this.consumed.size !== this.beams.length) throw new Error("Some IFC beams could not be represented in the supported OTXML hierarchy.");
        if (this.missingMaterials) this.warnings.push(`${this.missingMaterials} members assigned 'Default Steel' because IFC has no material assignment.`);
        if (this.shortReleases) this.warnings.push(`${this.shortReleases} members have five-character releases; preserved unchanged, not padded.`);
    }
}
