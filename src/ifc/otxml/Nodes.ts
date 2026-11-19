import { Element } from "xml-js";
import { finite } from "../StepParser";
import { element } from "./Xml";
import { Node } from "../../CommonData";

export class Nodes {
    public readonly data: Node[] = [];
    private readonly ids = new Map<string, string>();

    public get elements(): Element[] {
        return this.data.map((node) => element("Node", { ID: node.id, X: String(node.x), Y: String(node.y), Z: String(node.z) }));
    }

    public resolve(raw: string): string {
        const values = raw.split(",");
        if (values.length !== 3) throw new Error(`Invalid endpoint: ${raw}`);
        const coords = values.map((value) => finite(value, "endpoint"));
        const key = coords.join(",");
        const previous = this.ids.get(key);
        if (previous) return previous;
        const id = String(this.data.length + 1);
        this.data.push({ id, x: coords[0], y: coords[1], z: coords[2] });
        this.ids.set(key, id);
        return id;
    }
}
