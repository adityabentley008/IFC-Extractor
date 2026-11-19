import { Element } from "xml-js";
import { IfcModel } from "../IfcModel";
import { IfcEntity, Properties } from "../IfcTypes";
import { finite, stepText } from "../StepParser";
import { Materials } from "./Materials";
import { Nodes } from "./Nodes";
import { Sections } from "./Sections";
import { element } from "./Xml";
import { Member } from "../../CommonData";

export class PhysicalMemberBuilder {
    public readonly nodes = new Nodes();
    public readonly materials = new Materials();
    public readonly sections: Sections;
    private readonly consumed = new Set<number>();
    private missingMaterials = 0;
    private shortReleases = 0;

    constructor(private readonly model: IfcModel, convention: string,
        private readonly beams: IfcEntity[], private readonly warnings: string[]) {
        this.sections = new Sections(model, convention, beams, warnings);
    }

    public build(beam: IfcEntity, panelId: string): Element {
        return element("PhysicalMember", this.buildData(beam, panelId).sourceAttributes);
    }

    public buildData(beam: IfcEntity, panelId: string): Member {
        if (this.consumed.has(beam.id)) throw new Error(`Beam #${beam.id} was emitted twice.`);
        this.consumed.add(beam.id);
        const sectionName = this.model.property(beam.id, "Section Name") || this.model.property(beam.id, "Section");
        if (!sectionName) throw new Error(`Missing section on #${beam.id}.`);
        let material = this.model.property(beam.id, "Material Name");
        const materialAssignmentSource = material ? "exported" : "assumed";
        if (!material) {
            material = "Default Steel";
            this.missingMaterials++;
        }
        const start = this.nodes.resolve(this.model.required(beam.id, "StartPoint"));
        const end = this.nodes.resolve(this.model.required(beam.id, "EndPoint"));
        if (start === end) throw new Error(`Zero-length member #${beam.id}.`);
        const attributes: Properties = {
            PanelPropertyID: panelId, ID: String(beam.id), StartNodeID: start, EndNodeID: end,
            SectionID: this.sections.resolve(sectionName, beam), MaterialID: this.materials.resolve(material),
            BetaAngle: this.model.required(beam.id, "BetaAngle"), Label: stepText(beam.args[2]),
            SourceAppElementId: `IFC_${stepText(beam.args[0])}`,
            StartRelease: this.model.required(beam.id, "StartRelease"), EndRelease: this.model.required(beam.id, "EndRelease"),
        };
        finite(attributes.BetaAngle, "BetaAngle");
        if (!/^[01]{5,6}$/.test(attributes.StartRelease) || !/^[01]{5,6}$/.test(attributes.EndRelease)) {
            throw new Error(`Unsupported member release on #${beam.id}.`);
        }
        if (attributes.StartRelease.length !== 6 || attributes.EndRelease.length !== 6) this.shortReleases++;
        const memberTag = this.model.property(beam.id, "MemberTag");
        if (memberTag) attributes.MemberTag = memberTag;
        const result: Member = {
            id: attributes.ID, startNodeId: start, endNodeId: end, sectionId: attributes.SectionID,
            materialId: attributes.MaterialID, materialAssignmentSource,
            betaAngleDegrees: finite(attributes.BetaAngle, "BetaAngle"), label: attributes.Label,
            sourceElementId: attributes.SourceAppElementId, startRelease: attributes.StartRelease,
            endRelease: attributes.EndRelease, sourceAttributes: attributes,
        };
        if (memberTag) result.tag = memberTag;
        return result;
    }

    public finish(): void {
        if (this.consumed.size !== this.beams.length) throw new Error("Some IFC beams could not be represented in the supported OTXML hierarchy.");
        if (this.missingMaterials) this.warnings.push(`${this.missingMaterials} members assigned 'Default Steel' because IFC has no material assignment.`);
        if (this.shortReleases) this.warnings.push(`${this.shortReleases} members have five-character releases; preserved unchanged, not padded.`);
    }
}
