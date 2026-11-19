export interface IfcEntity {
    id: number;
    type: string;
    args: string[];
}

export type Properties = Record<string, string>;
export type EntityGetter = (id: number, type?: string) => IfcEntity;
export type ProfileShape = "HollowCircleProfile" | "LShapeProfile";
