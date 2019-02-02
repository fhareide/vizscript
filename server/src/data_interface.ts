// To parse this data:
//
//   import { Convert, Welcome } from "./file";
//
//   const welcome = Convert.toWelcome(json);

export interface Welcome {
    intellisense: Intellisense;
}

export interface Intellisense {
    scopes: Scopes;
}

export interface Scopes {
    scope: Scope[];
}

export interface Scope {
    description:    string;
    properties:     PropertiesClass;
    member_methods: MemberMethodsClass;
    name:           string;
}

export interface MemberMethodsClass {
    method: MethodElement[];
}

export interface MethodElement {
    description:          string;
    code_completion_hint: string;
    code_insight_hint:    string;
    name:                 string;
    type:                 Type;
    deprecated:           string;
    return_value_scope:   string;
}

export enum Type {
    Function = "Function",
    Property = "Property",
    Subroutine = "Subroutine",
}

export interface PropertiesClass {
    property: MethodElement[];
}

// Converts JSON strings to/from your types
export namespace Convert {
    export function toWelcome(json: string): Welcome {
        return JSON.parse(json);
    }

    export function welcomeToJson(value: Welcome): string {
        return JSON.stringify(value);
    }
}
