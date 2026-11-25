#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { convertIfcToCommonData } from "./IfcToCommonData";

export function convertIfcToCommonDataFiles(args: string[]): void {
    const [input, output, ...flags] = args;
    if (!input || !output || input.startsWith("--") || output.startsWith("--") ||
        flags.some((flag) => !["--allow-partial", "--allowPartial", "--compact", "--calculateSectionProfiles"].includes(flag)) ||
        new Set(flags).size !== flags.length || (flags.includes("--allow-partial") && flags.includes("--allowPartial"))) {
        throw new Error("Usage: ifc-to-common input.ifc output.json [--allow-partial] [--compact] [--calculateSectionProfiles]");
    }
    if (path.resolve(input).toLowerCase() === path.resolve(output).toLowerCase()) throw new Error("Output must not overwrite an input file.");
    const result = convertIfcToCommonData(fs.readFileSync(input, "utf8"), path.basename(input), {
        allowPartial: flags.includes("--allow-partial") || flags.includes("--allowPartial"),
        calculateSectionProfiles: flags.includes("--calculateSectionProfiles"),
    });
    for (const warning of result.warnings) console.warn(`IFC conversion warning: ${warning}`);
    const compact = flags.includes("--compact");
    const json = JSON.stringify(result.data, (key, value: unknown) =>
        compact && (key === "propertySets" || key === "faceBracingPropertySets") ? undefined : value, 2);
    fs.writeFileSync(output, `${json}\n`, { encoding: "utf8", flag: "wx" });
    console.log(`Created ${output}: ${JSON.stringify(result.counts)}`);
}

if (require.main === module) {
    try {
        convertIfcToCommonDataFiles(process.argv.slice(2));
    } catch (error) {
        console.error("IFC conversion failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
