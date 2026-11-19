export const angleContour = [
    [-0.014, -0.036], [-0.010, -0.036], [-0.010, 0.010],
    [0.036, 0.010], [0.036, 0.014], [-0.014, 0.014],
];

export function fixture(shape: "angle" | "tube" | "solid" | "tapered" | "parametricAngle" = "angle", horizontal = false, differentBracingSize = false): string {
    const parametric = shape === "solid" || shape === "tapered" || shape === "parametricAngle";
    const angle = shape === "angle" || shape === "parametricAngle";
    let next = 1;
    const lines: string[] = [];
    const entity = (type: string, args: string): number => {
        const id = next++;
        lines.push(`#${id}=IFC${type}(${args});`);
        return id;
    };
    const text = (value: string): string => `'${value.replace(/'/g, "''")}'`;
    const properties = (id: number, values: Record<string, string>, setName = "[OpenTower].[Test]"): void => {
        const refs = Object.entries(values).map(([key, value]) =>
            `#${entity("PROPERTYSINGLEVALUE", `${text(key)},$,IFCTEXT(${text(value)}),$`)}`);
        const set = entity("PROPERTYSET", `'pset',$,${text(setName)},$,(${refs.join(",")})`);
        entity("RELDEFINESBYPROPERTIES", `'relation',$,$,$,(#${id}),#${set}`);
    };
    const nested = (parent: number, child: number): void => {
        entity("RELNESTS", `'nest',$,$,$,#${parent},(#${child})`);
    };
    const point = (x: number, y: number, z: number): number => entity("CARTESIANPOINT", `(${x},${y},${z})`);
    const axis = (p: number): number => entity("AXIS2PLACEMENT3D", `#${p},$,$`);
    const parentPlacement = entity("LOCALPLACEMENT", `$,#${axis(point(10, 20, 30))}`);
    const sectionName = angle ? "EA50X50X4" : "CHS50X4.0";
    const profile = entity("BUILDINGELEMENTPROXY", `'profile',$,'${sectionName}','[OpenTower].[${angle ? "LShape" : "HollowCircle"}]',$,$,$,$,$`);
    properties(profile, angle ? { Width: "0", Depth: "1.969", Thickness: "0.157" } : { Radius: "0.984", WallThickness: "0.157" });
    const outer = shape === "parametricAngle"
        ? [[-0.025, 0.025], [0.025, 0.025], [0.025, 0.004], [-0.004, 0.004], [-0.004, -0.025], [-0.025, -0.025]]
        : angle ? angleContour
        : Array.from({ length: 8 }, (_, i) => [0.025 * Math.cos(i * Math.PI / 4), 0.025 * Math.sin(i * Math.PI / 4)]);
    const inner = outer.map(([x, z]) => [x * 0.84, z * 0.84]);
    // Independent inverse of the fixture's rotated, nonuniform map with a nonzero mapping origin.
    const mappedPoint = (x: number, y: number, z: number): number => point((y + 0.25) / 2 + 0.125, -(x - 0.5) / 3 + 0.25, (z - 1) / 4 - 0.5);
    const tiltCos = 1 / Math.sqrt(1 + 0.0012 ** 2), tiltSin = 0.0012 * tiltCos;
    const ring = (contour: number[][], t: number): number[] => contour.map(([x, z]) =>
        horizontal ? mappedPoint(t, x, z) : parametric
            ? mappedPoint(x * tiltCos + t * tiltSin, -z, t * tiltCos - x * tiltSin)
            : mappedPoint(x, -z, t));
    const bottom = ring(outer, 0), top = ring(shape === "tapered" ? inner : outer, horizontal ? 2 : 1);
    const bottomInner = ring(inner, 0), topInner = ring(inner, horizontal ? 2 : 1);
    const face = (ids: number[]): number => {
        const loop = entity("POLYLOOP", `(${ids.map((id) => `#${id}`).join(",")})`);
        return entity("FACE", `(#${entity("FACEOUTERBOUND", `#${loop},.T.`)})`);
    };
    const faces: number[] = [];
    for (let i = 0; i < outer.length; i++) {
        const j = (i + 1) % outer.length;
        faces.push(face([bottom[i], bottom[j], top[j], top[i]]));
        if (shape === "tube") {
            faces.push(face([bottomInner[i], topInner[i], topInner[j], bottomInner[j]]),
                face([bottom[i], bottomInner[i], bottomInner[j], bottom[j]]),
                face([top[i], top[j], topInner[j], topInner[i]]));
        }
    }
    if (angle) {
        faces.push(face([bottom[5], bottom[0], bottom[5], bottom[4], bottom[3], bottom[2], bottom[1], bottom[0]]), face(top));
    } else if (shape === "solid" || shape === "tapered") {
        faces.push(face(bottom), face(top));
    }
    const shell = entity("CLOSEDSHELL", `(${faces.map((id) => `#${id}`).join(",")})`);
    const brep = entity("FACETEDBREP", `#${shell}`);
    const body = entity("SHAPEREPRESENTATION", `$,'Body','Brep',(#${brep})`);
    const map = entity("REPRESENTATIONMAP", `#${axis(point(0.125, 0.25, -0.5))},#${body}`);
    const dirX = entity("DIRECTION", "(0.,1.,0.)"), dirY = entity("DIRECTION", "(-1.,0.,0.)");
    const target = entity("CARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM", `#${dirX},#${dirY},#${point(0.5, -0.25, 1)},2.,$,3.,4.`);
    const item = entity("MAPPEDITEM", `#${map},#${target}`);
    const mappedBody = entity("SHAPEREPRESENTATION", `$,'Body','MappedRepresentation',(#${item})`);
    const representation = entity("PRODUCTDEFINITIONSHAPE", `$,$,(#${mappedBody})`);
    const scaledMap = entity("REPRESENTATIONMAP", `#${axis(point(0, 0, 0))},#${mappedBody}`);
    const scaledTarget = entity("CARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM", `$,$,#${point(0, 0, 0)},2.,$,$,$`);
    const scaledItem = entity("MAPPEDITEM", `#${scaledMap},#${scaledTarget}`);
    const scaledBody = entity("SHAPEREPRESENTATION", `$,'Body','MappedRepresentation',(#${scaledItem})`);
    const scaledRepresentation = entity("PRODUCTDEFINITIONSHAPE", `$,$,(#${scaledBody})`);
    entity("APPLICATION", "$,'1','Bentley iModel IFC Export','iModel2IFC'");
    const metres = entity("SIUNIT", "*,.LENGTHUNIT.,$,.METRE.");
    const units = entity("UNITASSIGNMENT", `(#${metres})`);
    entity("PROJECT", `'project',$,$,$,$,$,$,$,#${units}`);
    const site = entity("SITE", "'site',$,'Site',$,$,$,$,$,.ELEMENT.,$,$,$,$,$");
    properties(site, { Latitude: "44.1", Longitude: "-72.9", Altitude: "682.025" }, "Site_Data");
    const tower = entity("BUILDING", "'tower',$,'Tower',$,$,$,$,$,.ELEMENT.,$,$,$");
    properties(tower, {
        ComponentName: "TowerInformation", "Tower Type": "SelfSupported", "Tower Convention": parametric ? "OpenTower" : "MS TOWER",
        "No. of Panels": "1", "No. of Legs": "3", "Tower ID": "demo", "Tower Name": "Test & Tower",
        "Bearing Angle/ North Orientation": "0", "Height of Tower": "6.56", "Top Face Width (ft)": "5",
        "Top Face Depth (ft)": "5", "Bottom Face Width (ft)": "5", "Bottom Face Depth (ft)": "5",
        ...(parametric ? { "Tower Tilt X": "0.07", "Tower Tilt Y": "0.01", ConcreteHeight: "1.14" } : { TowerShape: "ISOTRIANGLE" }),
        OTXMLAngle: parametric ? "0" : "210", Orientation: "OpenTower", "Unit System": parametric ? "Imperial" : "Metric",
    });
    const panel = entity("BUILDINGSTOREY", "'panel',$,'Panel 1',$,$,$,$,$,.ELEMENT.,$");
    properties(panel, {
        ComponentName: "Panel", PanelID: "1", "Height of Panel": "6.56", "Top Width of Panel": "5",
        "Bottom  Width of Panel": "5", "Top Elevation of Panel": "6.56", "Bottom Elevation of Panel": "0",
        "Face Bracing of Panel": "X BRACE", "Plan Bracing of Panel": "None", "Hip Bracing of Panel": "None",
        "Number Of Segments in Panel": "1", "Weight of Panel": "10",
    });
    nested(tower, panel);
    const coords = ["0,1,-1", "-1,1,1", "1,1,1"];
    const beam = (parent: number, index: number, leg: boolean): void => {
        const [x, y, z] = coords[index].split(",").map(Number);
        const placement = entity("LOCALPLACEMENT", `#${parentPlacement},#${axis(point(x - 10, -z - 20, y - 30))}`);
        const scaled = differentBracingSize && !leg && index === 0;
        const scale = scaled ? 2 : 1;
        const id = entity("BEAM", `'beam${index}${leg}',$,'${leg ? "Leg" : "DIAGONAL"}',$,$,#${placement},#${scaled ? scaledRepresentation : representation},$`);
        properties(id, {
            ComponentName: leg ? "Leg" : "TowerMember", StartPoint: coords[index],
            EndPoint: horizontal ? `${x + 2 * scale},${y},${z}` : parametric ? `${x + tiltSin * scale},${y + tiltCos * scale},${z}`
                : coords[leg ? index : (index + 1) % 3].replace(",1,", ",2,"),
            BetaAngle: horizontal || !leg ? "180" : "0", StartRelease: leg ? "00000" : "000000",
            EndRelease: leg ? "00000" : "000000",
            ...(leg ? { "Leg Name": ["A", "B", "C"][index], "Section Name": sectionName, "Material Name": "S 275" }
                : { Section: parametric ? angle ? "LShapeProfile" : "HollowCircleProfile" : sectionName, MemberTag: "DIAGONAL" }),
        });
        nested(parent, id);
    };
    for (let i = 0; i < 3; i++) beam(panel, i, true);
    const bracing = entity("SPACE", "'bracing',$,'FaceBracing',$,$,$,$,$,.ELEMENT.,.NOTDEFINED.,$");
    properties(bracing, { ComponentName: "FaceBracing" });
    nested(panel, bracing);
    for (let i = 0; i < 3; i++) {
        const face = entity("WALL", `'face${i}',$,'Face',$,$,$,$,$`);
        properties(face, { ComponentName: "Face", FaceName: `Face${["A", "B", "C"][i]}` });
        nested(bracing, face);
        const segment = entity("WINDOW", `'segment${i}',$,'Segment 1',$,$,$,$,$,$,$`);
        properties(segment, { ComponentName: "Segment", Name: "X 'Brace'; /* label */" });
        nested(face, segment);
        beam(segment, i, false);
    }
    return `ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
/* Forward references and multiline entities are valid. */
${lines.reverse().join("\n").replace(/=IFCPROPERTYSINGLEVALUE\(/g, "=IFCPROPERTYSINGLEVALUE(\n")}
ENDSEC;
END-ISO-10303-21;`;
}
