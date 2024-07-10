"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const ts_morph_1 = require("ts-morph");
const ts = __importStar(require("typescript"));
const fs = require("fs");
const path = require("path");
const dev = false;
const debug = true;
let inlineImports = 0;
const anyType = {
    core: "any",
    isNullable: true,
};
const coreKinds = [
    ts.SyntaxKind.BooleanKeyword,
    ts.SyntaxKind.NumberKeyword,
    ts.SyntaxKind.StringKeyword,
    ts.SyntaxKind.AnyKeyword,
    ts.SyntaxKind.VoidKeyword,
    ts.SyntaxKind.ThisKeyword,
    ts.SyntaxKind.TrueKeyword,
    ts.SyntaxKind.FalseKeyword,
    ts.SyntaxKind.NullKeyword,
    ts.SyntaxKind.UndefinedKeyword,
    ts.SyntaxKind.SymbolKeyword,
    ts.SyntaxKind.IntrinsicKeyword,
    ts.SyntaxKind.ObjectKeyword,
    ts.SyntaxKind.BigIntKeyword,
    ts.SyntaxKind.UnknownKeyword,
    ts.SyntaxKind.NeverKeyword,
];
function extract(files) {
    let program = ts.createProgram(files, { allowJs: true });
    const checker = program.getTypeChecker();
    const mainModules = [];
    let inlineCounter = 0;
    let parentNamedType = [];
    let namedListen;
    let currentFile;
    let sourceFile;
    const uses = [];
    const withNamed = (named, fn) => {
        parentNamedType.push(named);
        fn();
        parentNamedType.splice(parentNamedType.indexOf(named), 1);
    };
    const listenNamed = (fn, onRef) => {
        namedListen = onRef;
        fn();
        namedListen = undefined;
    };
    const isRelativeImport = (buf) => {
        const basePath = path.dirname(currentFile) + "/" + buf.replace(/["']/g, "");
        let imp = basePath + ".d.ts";
        console.log("tryAddRelativeImport", imp, fs.existsSync(imp), buf);
        if (!fs.existsSync(imp)) {
            imp = basePath + "/index.d.ts";
            if (!fs.existsSync(imp)) {
                return false;
            }
        }
        return true;
    };
    const parseNodes = (source, lib) => {
        const { typedefs, structs, funcs, vars, modules, enums, imports } = lib.items;
        const pushImport = (declare) => {
            if (!declare.local) {
                const spl = declare.from.split("/");
                const pkg = spl[0];
                if (!uses.includes(pkg)) {
                    uses.push(pkg);
                }
            }
            imports.push(declare);
        };
        const pushStruct = (struct) => {
            structs.push(struct);
        };
        const parseType = (type) => {
            var _a, _b;
            if (!type) {
                return anyType;
            }
            let ret;
            const lineNumber = getLineNumber(type);
            if (ts.isUnionTypeNode(type)) {
                ret = {
                    union: type.types.map((type) => parseType(type)),
                };
            }
            else if (ts.isNamedTupleMember(type)) {
                ret = (_a = parseType(type.type)) !== null && _a !== void 0 ? _a : anyType;
            }
            else if (
            //ts.isConstructorTypeNode(type)
            ts.isConditionalTypeNode(type)) {
                ret = anyType;
            }
            else if (ts.isTypeQueryNode(type)) {
                const name = type.exprName.getText();
                ret = {
                    accessor: name,
                    _: lineNumber,
                };
                //console.log('TypeQuery', name, ret, lineNumber);
            }
            else if (ts.isImportTypeNode(type)) {
                const path = type.argument.getText().replace(/["']/g, "");
                const alias = "typingsinline" + inlineImports;
                const typeName = type.qualifier.getText();
                const ref = alias + "." + typeName;
                pushImport({
                    from: path,
                    alias,
                    types: [typeName],
                    local: true,
                });
                ret = {
                    ref,
                    targs: parseTypeArguments(type.typeArguments),
                };
                inlineImports++;
            }
            else if (ts.isTypeOperatorNode(type)) {
                ret = {
                    operator: type.operator,
                    type: parseType(type.type),
                };
            }
            else if (ts.isTupleTypeNode(type)) {
                ret = {
                    tuple: type.elements.map((type) => parseType(type)),
                };
            }
            else if (ts.isIntersectionTypeNode(type)) {
                ret = {
                    intersect: type.types.map((type) => parseType(type)),
                };
            }
            else if (coreKinds.indexOf(type.kind) > -1 ||
                //type.kind in ts.KeywordSyntaxKind ||
                ts.isThisTypeNode(type) ||
                ts.isLiteralTypeNode(type) ||
                ts.isTemplateLiteralTypeNode(type)) {
                ret = {
                    core: ts.isTemplateLiteralTypeNode(type) ? "string" : type.getText(),
                };
            }
            else if (ts.isMappedTypeNode(type)) {
                ret = {
                    key: Object.assign({ isNullable: false }, parseTypeParameter(type.typeParameter)),
                    value: parseType(type.type),
                };
            }
            else if (ts.isFunctionTypeNode(type) ||
                ts.isConstructorTypeNode(type)) {
                ret = {
                    ctor: ts.isConstructorTypeNode(type),
                    generics: parseTypeParameters(type.typeParameters),
                    returns: parseType(type.type),
                    params: parseParameters(type.parameters),
                };
            }
            else if (ts.isIndexedAccessTypeNode(type)) {
                ret = {
                    index: parseType(type.indexType),
                    obj: parseType(type.objectType),
                };
            }
            else if (ts.isExpressionWithTypeArguments(type)) {
                const ref = type.expression.getText();
                ret = {
                    ref,
                    targs: parseTypeArguments(type.typeArguments),
                };
            }
            else if (ts.isTypeReferenceNode(type)) {
                const ref = type.typeName.getText();
                if (ref == "Promise" && 1 < 0) {
                    const sub = (_b = type.typeArguments) === null || _b === void 0 ? void 0 : _b[0];
                    ret = Object.assign({ isFuture: true }, (sub ? parseType(sub) : anyType));
                }
                else {
                    namedListen === null || namedListen === void 0 ? void 0 : namedListen(ref);
                    const tn = type.typeName;
                    if (ts.isQualifiedName(tn)) {
                        ret = anyType;
                    }
                    else {
                        ret = {
                            ref,
                            targs: parseTypeArguments(type.typeArguments),
                        };
                    }
                }
            }
            else if (ts.isParenthesizedTypeNode(type) || ts.isRestTypeNode(type)) {
                ret = parseType(type.type);
            }
            else if (ts.isArrayTypeNode(type)) {
                ret = {
                    core: "array",
                    targs: [parseType(type.elementType)],
                };
            }
            else if (ts.isTypeLiteralNode(type)) {
                let name;
                // if (ownerName) {
                //   name = `${ownerName}$`;
                //   const used = namedInline.filter((item) => item == name);
                //   if (used.length) {
                //     name += used.length;
                //   }
                // }
                const prototype = type.members.find((m) => {
                    var _a;
                    return ((_a = m.name) === null || _a === void 0 ? void 0 : _a.getText()) == "prototype";
                });
                if (prototype && ts.isPropertySignature(prototype) && prototype.type) {
                    //return parseType(prototype.type);
                }
                if (!name) {
                    name = `IInline${inlineCounter}`;
                    inlineCounter++;
                }
                let struct = { isClass: false };
                const generics = [];
                listenNamed(() => {
                    var _a;
                    struct = Object.assign(Object.assign(Object.assign({}, struct), parseStruct(undefined, name, type.members, undefined)), { isInline: true, parent: (_a = parentNamedType[0]) === null || _a === void 0 ? void 0 : _a.name });
                }, (ref) => {
                    for (const parent of parentNamedType) {
                        for (const generic of parent.generics) {
                            if (generic.name == ref) {
                                if (!generics.some((g) => g.name == ref)) {
                                    generics.push(generic);
                                }
                                return;
                            }
                        }
                    }
                });
                struct.generics = generics;
                pushStruct(struct);
                const targs = [];
                for (const g of generics) {
                    const type = g.default || g.constraint;
                    if (!type) {
                        break;
                    }
                    targs.push(type);
                }
                ret = {
                    ref: name,
                    targs: targs,
                };
            }
            else if (ts.isTypePredicateNode(type)) {
                ret = {
                    predicate: type.parameterName.getText(),
                    type: parseType(type.type),
                };
            }
            else {
                ret = {
                    unknown: type.getText(),
                };
                if (debug) {
                    console.error("Unknown type", type.getText(), "Kind: " + type.kind, type.getSourceFile().fileName, "lineNumber:", lineNumber);
                }
            }
            ret.isNullable = !!ret.isNullable;
            ret._ = lineNumber;
            ret.source = type.getFullText();
            return ret;
        };
        const parseTypeArguments = (typeArguments) => {
            var _a;
            return (_a = typeArguments === null || typeArguments === void 0 ? void 0 : typeArguments.map((type) => parseType(type))) !== null && _a !== void 0 ? _a : [];
        };
        const parseTypeParameters = (typeParameters) => {
            var _a;
            return (_a = typeParameters === null || typeParameters === void 0 ? void 0 : typeParameters.map(parseTypeParameter)) !== null && _a !== void 0 ? _a : [];
        };
        const parseTypeParameter = (typeParameter) => {
            return addSource(typeParameter, {
                name: typeParameter.name.getText(),
                constraint: typeParameter.constraint
                    ? parseType(typeParameter.constraint)
                    : undefined,
                default: typeParameter.default
                    ? parseType(typeParameter.default)
                    : undefined,
                _: getLineNumber(typeParameter),
            });
        };
        const addSource = (node, ret) => {
            if (node) {
                ret._ = getLineNumber(node);
                ret.source = node.getFullText();
            }
            else {
                ret._ = -1;
                ret.source = "__generated";
            }
            return ret;
        };
        const addModifiers = (node, ret) => {
            ret.isStatic = false;
            ret.isReadonly = false;
            ret.isPrivate = false;
            if (ts.canHaveModifiers(node)) {
                const modifiers = ts.getModifiers(node);
                if (modifiers) {
                    ret.isStatic = modifiers.some((m) => m.kind == ts.SyntaxKind.StaticKeyword);
                    ret.isPrivate = modifiers.some((m) => m.kind == ts.SyntaxKind.PrivateKeyword);
                    ret.isReadonly = modifiers.some((modifier) => modifier.getText() == "readonly");
                }
            }
            return ret;
        };
        const parseMembers = (ownerName, members) => {
            var _a;
            const props = [];
            const indexes = [];
            const ctors = [];
            const calls = [];
            for (const member of members) {
                const ln = getLineNumber(member);
                const doc = parseDoc(member);
                const prop = addSource(member, {
                    doc,
                    isMethod: ts.isFunctionLike(member) &&
                        !ts.isSetAccessorDeclaration(member) &&
                        !ts.isGetAccessorDeclaration(member),
                });
                if (ts.isCallSignatureDeclaration(member)) {
                    calls.push(addSource(member, {
                        params: parseParameters(member.parameters),
                        type: parseType(member.type),
                        generics: parseTypeParameters(member.typeParameters),
                        doc,
                    }));
                    continue;
                }
                else if (ts.isIndexSignatureDeclaration(member)) {
                    const param = member.parameters[0];
                    indexes.push(addModifiers(member, addSource(member, {
                        key: parseType(param.type),
                        value: parseType(member.type),
                        doc,
                    })));
                }
                else {
                    let name = ts.isConstructorDeclaration(member) ||
                        ts.isConstructSignatureDeclaration(member)
                        ? "__new"
                        : (_a = member.name) === null || _a === void 0 ? void 0 : _a.getText();
                    prop.name = name;
                    prop.generics =
                        ts.isFunctionLike(member) || ts.isMethodDeclaration(member)
                            ? parseTypeParameters(member.typeParameters)
                            : [];
                    withNamed(prop, () => {
                        prop.isGetter = ts.isGetAccessorDeclaration(member);
                        prop.isSetter = ts.isSetAccessorDeclaration(member);
                        prop.isNullable = false;
                        prop.isStatic = false;
                        prop.isReadonly = false;
                        prop.isPrivate = false;
                        if (ts.isComputedPropertyName(member)) {
                            if (ts.isPropertyAccessExpression(member.expression)) {
                                //prop.typedName = parseType(member.expression.name.type);
                            }
                        }
                        addModifiers(member, prop);
                        if (ts.isFunctionLike(member) ||
                            ts.isConstructorDeclaration(member) ||
                            ts.isConstructSignatureDeclaration(member) ||
                            ts.isMethodDeclaration(member) ||
                            ts.isMethodSignature(member)) {
                            prop.params = parseParameters(member.parameters);
                        }
                        if (ts.isConstructorDeclaration(member) ||
                            ts.isConstructSignatureDeclaration(member)) {
                            if (ts.isConstructSignatureDeclaration(member)) {
                                prop.type = parseType(member.type);
                            }
                            ctors.push(prop);
                        }
                        else {
                            const type = ts.isFunctionLike(member) ||
                                ts.isPropertySignature(member) ||
                                ts.isMethodDeclaration(member) ||
                                ts.isMethodSignature(member) ||
                                ts.isPropertyDeclaration(member) ||
                                ts.isGetAccessor(member)
                                ? member.type
                                : ts.isSetAccessorDeclaration(member)
                                    ? member.parameters[0].type
                                    : null;
                            if (!type) {
                                if (dev) {
                                    console.error("NoType", name, ln);
                                }
                                return;
                            }
                            prop.isNullable =
                                (ts.isTypeElement(type) && type.questionToken != null) ||
                                    ((ts.isPropertySignature(member) ||
                                        ts.isMethodDeclaration(member)) &&
                                        member.questionToken != null);
                            prop.type = parseType(type);
                            props.push(prop);
                        }
                    });
                }
            }
            return { members: props, indexes, ctors, calls };
        };
        const parseParameters = (params) => {
            return params.map((p) => {
                const ret = {
                    name: p.name.getText(),
                    type: parseType(p.type),
                    varargs: p.dotDotDotToken != null,
                    isNullable: p.questionToken != null,
                };
                return ret;
            });
        };
        const parseStruct = (node, ownerName, members, typeParameters) => {
            const generics = parseTypeParameters(typeParameters);
            const ret = {
                _: node ? getLineNumber(node) : -1,
                name: ownerName,
                generics,
                doc: parseDoc(node),
                heritage: [],
                isInline: false,
                parent: "",
                source: "",
            };
            withNamed(ret, () => {
                var _a, _b;
                const { indexes, members: m, ctors, calls, } = parseMembers(ownerName, members);
                if (node &&
                    (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node))) {
                    ret.heritage =
                        (_b = (_a = node.heritageClauses) === null || _a === void 0 ? void 0 : _a.map((h) => {
                            return h.types.map((t) => parseType(t));
                        })) !== null && _b !== void 0 ? _b : [];
                }
                ret["indexes"] = indexes;
                ret["ctors"] = ctors;
                ret["members"] = m;
                ret["calls"] = calls;
            });
            return ret;
        };
        const parseDoc = (node) => {
            let ret;
            const name = node === null || node === void 0 ? void 0 : node.name;
            if (node && name) {
                let symbol = checker.getSymbolAtLocation(name);
                if (symbol) {
                    const parts = symbol.getDocumentationComment(checker);
                    const doc = ts.displayPartsToString(parts);
                    const text = name.getFullText();
                    const start = text.indexOf("/**");
                    const end = text.indexOf("*/");
                    if (start > -1 && end > -1) {
                        const f = text.substring(start + 3, end);
                        ret = f
                            .split("\n")
                            .map((line) => {
                            const l = line.trim();
                            if (l.startsWith("*")) {
                                return l.substring(1);
                            }
                            return l;
                        })
                            .join("\n")
                            .trim();
                    }
                    if (!ret) {
                        ret = doc;
                    }
                }
            }
            return ret !== null && ret !== void 0 ? ret : "";
        };
        const parseInterface = (node) => {
            var _a, _b;
            const name = node.name.text;
            const current = sourceFile.hasNoDefaultLib
                ? (_a = structs.find((struct) => struct.name == name)) !== null && _a !== void 0 ? _a : (_b = mainModules
                    .find((m) => m.namespace == lib.namespace &&
                    m.items.structs.find((struct) => struct.name == name))) === null || _b === void 0 ? void 0 : _b.items.structs.find((struct) => struct.name == name)
                : undefined;
            const parsed = Object.assign(Object.assign({}, parseStruct(node, name, node.members, node.typeParameters)), { isClass: false });
            if (current) {
                for (const item of parsed.indexes) {
                    current.indexes.push(item);
                }
                for (const item of parsed.members) {
                    current.members.push(item);
                }
                for (const item of parsed.ctors) {
                    current.ctors.push(item);
                }
                for (const item of parsed.calls) {
                    current.calls.push(item);
                }
            }
            else {
                pushStruct(parsed);
            }
        };
        const getLineNumber = (node) => node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line +
            1;
        const parseNode = (node, sourceFile) => {
            var _a, _b, _c, _d;
            // This is an incomplete set of AST nodes which could have a top level identifier
            // it's left to you to expand this list, which you can do by using
            // https://ts-ast-viewer.com/ to see the AST of a file then use the same patterns
            // as below
            const lineNumber = getLineNumber(node);
            if (ts.isFunctionDeclaration(node)) {
                const name = node.name;
                if (name) {
                    const type = node.type;
                    const func = addSource(node, {
                        _: lineNumber,
                        name: name.getText(),
                        type: type ? parseType(type) : anyType,
                        generics: parseTypeParameters(node.typeParameters),
                        doc: parseDoc(node),
                        params: parseParameters(node.parameters),
                    });
                    funcs.push(func);
                }
                //type = checker.getTypeAtLocation(node.type!).getSymbol();
            }
            else if (ts.isInterfaceDeclaration(node)) {
                parseInterface(node);
            }
            else if (ts.isVariableDeclaration(node)) {
                const name = node.name.getText();
                if (name == "Headers") {
                    console.log("HeyCatch, ", name != lib.namespace &&
                        !modules.find((v) => {
                            return v.name == name;
                        }) &&
                        !vars.find((v) => v.name == name));
                }
                if (name != lib.namespace &&
                    !modules.find((v) => {
                        return v.name == name;
                    }) &&
                    !vars.find((v) => v.name == name)) {
                    const parsedType = parseType(node.type);
                    const type = node.type;
                    if (name == "Headers") {
                        console.log("HeyCatch2, ", ts.isTypeLiteralNode(type));
                    }
                    if (type && ts.isTypeLiteralNode(type)) {
                        const prototype = type.members.find((m) => {
                            var _a;
                            return ((_a = m.name) === null || _a === void 0 ? void 0 : _a.getText()) == "prototype";
                        });
                        const cl = structs.find((struct) => struct.name == name);
                        if (cl) {
                            cl.declaredAsVar = !!(prototype &&
                                ts.isPropertySignature(prototype) &&
                                prototype.type);
                            if (name == "Headers") {
                                console.log("HeyCatch4, ", cl.declaredAsVar);
                            }
                        }
                        if (name == "Headers" && !cl) {
                            console.log("HeyCatch3, ", false);
                        }
                    }
                    vars.push(addSource(node, {
                        _: lineNumber,
                        name,
                        isReadonly: true,
                        isStatic: false,
                        isNullable: false,
                        doc: parseDoc(node),
                        type: parsedType,
                    }));
                }
            }
            else if (ts.isClassDeclaration(node)) {
                if (node.name) {
                    const name = node.name.text;
                    pushStruct(Object.assign(Object.assign({}, parseStruct(node, name, node.members, node.typeParameters)), { isClass: true }));
                }
            }
            else if (ts.isExportDeclaration(node) ||
                ts.isExportAssignment(node) ||
                ts.isImportEqualsDeclaration(node)) {
            }
            else if (ts.isTypeAliasDeclaration(node)) {
                const name = node.name.text;
                const typedef = { name };
                withNamed(typedef, () => {
                    typedef.generics = parseTypeParameters(node.typeParameters);
                    const type = parseType(node.type);
                    type.parent = name;
                    typedef.type = type;
                    typedef.doc = parseDoc(node);
                    typedefs.push(addSource(node, typedef));
                });
            }
            else if (ts.isModuleDeclaration(node)) {
                if (node.body && node.name.text != "global") {
                    let module = modules.find((it) => it.namespace == node.name.text);
                    if (!module && node.name.text == lib.namespace) {
                        module = lib;
                    }
                    if (!module) {
                        module = (_a = mainModules
                            .find((it) => it.items.modules.some((it) => it.namespace == node.name.text))) === null || _a === void 0 ? void 0 : _a.items.modules.find((it) => it.namespace == node.name.text);
                    }
                    if (!module) {
                        module = {
                            _: lineNumber,
                            namespace: node.name.text,
                            from: "submodule " + lib.namespace,
                            items: {
                                structs: [],
                                typedefs: [],
                                modules: [],
                                funcs: [],
                                vars: [],
                                enums: [],
                                imports: [],
                                file: sourceFile.fileName,
                            },
                        };
                        modules.push(module);
                    }
                    parseNodes(node.body, module);
                }
            }
            else if (ts.isEnumDeclaration(node)) {
                const en = addSource(node, {
                    name: node.name.text,
                    doc: parseDoc(node),
                });
                const members = [];
                for (const member of node.members) {
                    const m = addSource(member, {
                        name: member.name.getText(),
                        doc: parseDoc(member),
                        value: (_c = (_b = member.initializer) === null || _b === void 0 ? void 0 : _b.getText()) !== null && _c !== void 0 ? _c : "",
                    });
                    members.push(m);
                }
                en.members = members;
                enums.push(en);
            }
            else if (ts.isImportDeclaration(node)) {
                const from = node.moduleSpecifier.getText().replace(/["']/g, "");
                let alias = "";
                let types = [];
                const bindings = (_d = node.importClause) === null || _d === void 0 ? void 0 : _d.namedBindings;
                const local = isRelativeImport(from);
                if (bindings) {
                    if (ts.isNamespaceImport(bindings)) {
                        alias = bindings.name.getText();
                    }
                    else if (ts.isNamedImports(bindings)) {
                        types = bindings.elements.map((el) => el.name.getText());
                    }
                }
                const imp = {
                    alias,
                    from,
                    types,
                    local,
                };
                pushImport(imp);
                console.log("ImportDECLARE", from, imp, sourceFile.fileName);
            }
            else {
                if (node.kind != 1) {
                    console.error("Unknown node type", node.getSourceFile().fileName, lineNumber, "kind:", node.kind);
                }
            }
            return undefined;
        };
        const extractNode = (node) => {
            parseNode(node, node.getSourceFile());
        };
        ts.forEachChild(source, (node) => {
            if (ts.isNamespaceExportDeclaration(node)) {
                lib.namespace = node.name.text;
            }
        });
        var x = 0;
        ts.forEachChild(source, (node) => {
            //if (x > 4) return;
            //   console.log('Node', node.kind, '. ' + node.pos + ' of ' + count);
            //   fs.writeFileSync(jsonFile, stringify(node, (key, val) => key.substring(0, 1) == '_' ? undefined : val));
            // x++;
            // return;
            if (ts.isVariableStatement(node)) {
                node.declarationList.forEachChild(extractNode);
            }
            else {
                extractNode(node);
            }
            x++;
        });
    };
    const toExport = [];
    const done = [];
    for (var x = 0; x < files.length; x++) {
        const file = files[x];
        if (!fs.existsSync(file)) {
            throw "File doesnt exist: " + file;
        }
        if (done.includes(file)) {
            console.log("Skipping already done file " + file);
            continue;
        }
        done.push(file);
        currentFile = file;
        if (debug) {
            //console.log("Parsing", file);
        }
        sourceFile = program.getSourceFile(file);
        const module = {
            _: -1,
            namespace: "",
            from: "mainLoop " + file,
            items: {
                structs: [],
                typedefs: [],
                modules: [],
                funcs: [],
                vars: [],
                enums: [],
                imports: [],
            },
            file,
        };
        mainModules.push(module);
        parseNodes(sourceFile, module);
        if (dev) {
            //const jsonFile = file.replace(".d.ts", ".d.json");
            //fs.writeFileSync(jsonFile, JSON.stringify(mainModule, null, 2));
        }
        else {
            const path = file.split("/");
            const name = path[path.length - 1];
            toExport.push(Object.assign(Object.assign({}, module), { name }));
        }
    }
    if (!dev) {
        //console.log(JSON.stringify(toExport, null, 2));
        console.log("FFUSES", uses);
        fs.writeFileSync("./toExport.json", JSON.stringify({ files: toExport, uses }, null, 2));
        //console.log("Written toExport.json!");
    }
    //console.log("Done extracting\n");
}
// Run the extract function with the script's arguments
//extract(["d/go.d.ts"]); //, "d/t2.d.ts", "d/t3.d.ts"]);
// extract([
//   "d/lib.dom.d.ts",
//   "d/lib.es5.d.ts",
//   "d/lib.webworker.importscripts.d.ts",
//   "d/lib.scripthostimport { namespace } from '../../ts2dart/work/deno/download/0lib.deno.ns.d';
// ]);import { proto } from '../../typings/work/gojs/out/package/projects/pdf/pdfkit';
//console.log(process.argv.splice(2));
const type = process.argv[2];
if (type) {
    if (type == "-f") {
        extract([...process.argv.splice(3)]);
    }
    else if (type == "-t") {
        const project = new ts_morph_1.Project();
        project.addSourceFilesAtPaths(process.argv[3]);
        project.resolveSourceFileDependencies();
        const files = project.getSourceFiles().map((s) => s.getFilePath());
        console.log("CrawledFiles:");
        console.log(files.join("\n"));
        extract(files);
    }
}
