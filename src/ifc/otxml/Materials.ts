import { Element } from "xml-js";
import { element } from "./Xml";
import { Material } from "../../CommonData";

export class Materials {
    public readonly data: Material[] = [];
    private readonly ids = new Map<string, string>();

    public get elements(): Element[] {
        return this.data.reduce<Element[]>((all, material) => all.concat([
            element("Material", { ID: material.id, Name: material.name }),
            ...material.properties.map((p) => element("MaterialProperty", {
                RefID: material.id, Name: p.name, Description: p.description, Value: p.value, Unit: p.unit,
            })),
        ]), []);
    }

    public resolve(name: string): string {
        const previous = this.ids.get(name);
        if (previous) return previous;
        const id = String(this.ids.size + 1);
        const defaults: Array<[string, string, string]> = [
            ["E", "205000", "N/mm2"], ["G", "78846.153846", "N/mm2"], ["Fy", "275", "N/mm2"], ["Fu", "430", "N/mm2"],
            ["Mu", "0.3", ""], ["Rho", "7850", "kg/m3"], ["Gamma", "76.9822", "kN/m3"],
            ["Alpha", "0.000012", "/C"], ["CDAMP", "0.03", ""],
        ];
        this.data.push({ id, name, propertiesSource: "assumed", properties: defaults.map(([property, value, unit]) =>
            ({ name: property, description: property, value, unit })) });
        this.ids.set(name, id);
        return id;
    }
}
