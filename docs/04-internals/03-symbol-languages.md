---
title: Symbol languages
description: Which file extensions resolve structurally and what each grammar exposes as a declaration.
---

# Symbol languages

Structural (tree-sitter) symbol resolution is available for these file
extensions. Anything else still works with a region marker.

```ts docref=packages/core/src/languages.ts#LanguageId:85e3e28e
export type LanguageId =
	| 'typescript'
	| 'tsx'
	| 'javascript'
	| 'go'
	| 'python'
	| 'rust'
	| 'java'
	| 'c'
	| 'cpp'
	| 'csharp'
	| 'ruby'
	| 'php'
	| 'swift'
	| 'kotlin'
	| 'scala'
	| 'bash'
	| 'proto';
```

That list is *which* files resolve; the map below is *what* each grammar
exposes as a declaration. TypeScript, JavaScript, TSX, Go and Python use bespoke
collectors; every other language is data-driven via `namedCollector(types,
scope)`, where `types` is its declaration node types and `scope` (`functionLike`
/ `valueBindings`) marks which nodes open a function body and which are value
bindings. So a `const`/`val`/`property` inside a function body is treated as a
local and never collected, exactly as the TypeScript collector does. Fields and
properties are addressable too: a class field, a struct field, or an
interface/protocol property resolves as `Type.field`, qualified by its enclosing
type, because these are slow-moving API surface that documentation names
constantly. A bare field name shared by two types stays ambiguous and fails
closed; the qualified form resolves, and an exact top-level name always wins over
a same-leaf field. Proto goes furthest: a message field or enum value *number* is
the wire contract, the most drift-prone part of a schema, so `CreateRequest.shares`
is addressable for that reason as well.

```ts docref=packages/core/src/symbols.ts#COLLECTORS:ca8a51f1
const COLLECTORS: Record<LanguageId, Collector> = {
	typescript: collectTsLike,
	tsx: collectTsLike,
	javascript: collectTsLike,
	go: collectGo,
	python: collectPython,
	rust: namedCollector(
		// field_declaration: a struct field is API contract, addressable as
		// `Struct.field` (the generic walk qualifies it through the struct on the
		// stack). A function-body local is a let_declaration, not collected.
		['function_item', 'struct_item', 'enum_item', 'union_item', 'trait_item', 'mod_item', 'type_item', 'const_item', 'static_item', 'macro_definition', 'field_declaration'],
		{ functionLike: ['function_item'], valueBindings: ['const_item', 'static_item'] }
	),
	java: namedCollector(
		['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration', 'annotation_type_declaration', 'method_declaration', 'constructor_declaration'],
		{ functionLike: ['method_declaration', 'constructor_declaration'] }
	),
	c: namedCollector(
		['function_definition', 'struct_specifier', 'enum_specifier', 'union_specifier', 'type_definition'],
		{ functionLike: ['function_definition'] }
	),
	cpp: namedCollector(
		['function_definition', 'struct_specifier', 'class_specifier', 'enum_specifier', 'union_specifier', 'namespace_definition', 'type_definition'],
		{ functionLike: ['function_definition'] }
	),
	csharp: namedCollector(
		['class_declaration', 'struct_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration', 'namespace_declaration', 'delegate_declaration', 'method_declaration', 'constructor_declaration', 'property_declaration'],
		{ functionLike: ['method_declaration', 'constructor_declaration'] }
	),
	ruby: namedCollector(['method', 'singleton_method', 'class', 'module'], {
		functionLike: ['method', 'singleton_method']
	}),
	php: namedCollector(
		['function_definition', 'method_declaration', 'class_declaration', 'interface_declaration', 'trait_declaration', 'enum_declaration'],
		{ functionLike: ['function_definition', 'method_declaration'] }
	),
	swift: namedCollector(['function_declaration', 'class_declaration', 'protocol_declaration', 'property_declaration'], {
		functionLike: ['function_declaration'],
		valueBindings: ['property_declaration']
	}),
	kotlin: namedCollector(['function_declaration', 'class_declaration', 'object_declaration', 'property_declaration'], {
		functionLike: ['function_declaration'],
		valueBindings: ['property_declaration']
	}),
	scala: namedCollector(
		['function_definition', 'class_definition', 'object_definition', 'trait_definition', 'type_definition', 'val_definition'],
		{ functionLike: ['function_definition'], valueBindings: ['val_definition'] }
	),
	bash: namedCollector(['function_definition'], { functionLike: ['function_definition'] }),
	// proto: message (type-like), enum, service (interface-like), rpc
	// (method-like), plus message fields and enum values. Unlike struct fields
	// elsewhere, a proto field/value number is the wire contract and the most
	// drift-prone thing in a schema, so `Message.field` is addressable. `field`
	// covers oneof members too (the grammar reuses it); `value` is the enum
	// constant. Field options/defaults are other node types and are not swept in.
	// No function bodies, so no scope flags.
	proto: namedCollector(['message', 'enum', 'service', 'rpc', 'field', 'map_field', 'value'])
};
```

TypeScript/JavaScript/TSX, Go and Python predate that table and use bespoke
collectors, so their parsed kinds live in the code below rather than the set
above:

<!-- docref: begin src=packages/core/src/symbols.ts#TS_NAMED:b733aa56,packages/core/src/symbols.ts#FUNCTION_LIKE:33f379e5,packages/core/src/symbols.ts#walkTs:5814db7c,packages/core/src/symbols.ts#collectGo:eced0edd,packages/core/src/symbols.ts#collectPython:ea14a3ae -->

- **TypeScript / JavaScript / TSX:** functions (including generators), classes
  (including abstract), interfaces, type aliases, enums, methods, class fields,
  interface properties, and top-level `const`/`let`/`var`, but never a binding
  declared inside a function body; nested functions stay addressable.
- **Go:** functions, methods (nested under their receiver type), `type`, `const`
  and `var` specs, and a struct's named fields (`Type.field`); an embedded field
  is a type reference, not a member, and is not collected.
- **Python:** functions and classes, including nested ones, and class-level
  attributes (`Class.attr`); a binding inside a function body, including a
  `self.x` assignment, is not a symbol.

<!-- docref: end -->
