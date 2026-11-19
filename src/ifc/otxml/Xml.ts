import { Element, js2xml } from "xml-js";
import { Properties } from "../IfcTypes";

export function element(name: string, attributes: Properties = {}, elements: Element[] = []): Element {
    return { type: "element", name, attributes, elements };
}

export function writeOtxml(elements: Element[]): string {
    const document: Element = {
        declaration: { attributes: { version: "1.0", encoding: "utf-8" } },
        elements: [element("Staad", {}, elements)],
    };
    return js2xml(document, {
        compact: false, spaces: 2,
        // xml-js escapes quotes before this callback, but not ampersands or angle brackets.
        attributeValueFn: (_value, key, _name, current) => String((current as Element).attributes![key])
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
            .replace(/\r/g, "&#13;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;"),
    });
}
