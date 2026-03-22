import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  Diagnostic,
  DiagnosticSeverity,
  CompletionItem,
  CompletionItemKind,
  DocumentSymbol,
  SymbolKind,
  FoldingRange,
  FoldingRangeKind,
  Hover,
  MarkupKind,
  TextEdit,
  Range,
  Position,
} from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'
import {
  parse,
  print,
  Document,
  ValueNode,
  ObjectNode,
  ArrayNode,
  Property,
} from 'maml-ast'

const connection = createConnection(ProposedFeatures.all)
const documents = new TextDocuments(TextDocument)

const astCache = new Map<string, Document>()

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      completionProvider: {
        triggerCharacters: ['"', ':', ' '],
      },
      hoverProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      documentFormattingProvider: true,
    },
  }
})

documents.onDidChangeContent((change) => {
  validateDocument(change.document)
})

documents.onDidClose((e) => {
  astCache.delete(e.document.uri)
})

function validateDocument(document: TextDocument): void {
  const text = document.getText()
  const diagnostics: Diagnostic[] = []

  try {
    const doc = parse(text)
    astCache.set(document.uri, doc)
    checkDuplicateKeys(doc.value, diagnostics)
  } catch (e) {
    astCache.delete(document.uri)
    if (e instanceof SyntaxError) {
      const { line, column } = parseErrorLocation(e.message)
      const pos = Position.create(
        Math.max(0, line - 1),
        Math.max(0, column - 1),
      )
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start: pos, end: pos },
        message: parseErrorMessage(e.message),
        source: 'maml',
      })
    }
  }

  connection.sendDiagnostics({ uri: document.uri, diagnostics })
}

function parseErrorLocation(msg: string): { line: number; column: number } {
  const match = msg.match(/on line (\d+)/)
  return {
    line: match ? parseInt(match[1], 10) : 1,
    column: 1,
  }
}

function parseErrorMessage(msg: string): string {
  const idx = msg.indexOf(' on line ')
  return idx !== -1 ? msg.substring(0, idx) : msg
}

function checkDuplicateKeys(
  node: ValueNode,
  diagnostics: Diagnostic[],
): void {
  if (node.type === 'Object') {
    for (const prop of node.properties) {
      checkDuplicateKeys(prop.value, diagnostics)
    }
  } else if (node.type === 'Array') {
    for (const el of node.elements) {
      checkDuplicateKeys(el, diagnostics)
    }
  }
}

// --- Completion ---

connection.onCompletion((params): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri)
  if (!document) return []

  const text = document.getText()
  const offset = document.offsetAt(params.position)
  const context = getCompletionContext(text, offset)

  if (context === 'value') {
    return [
      {
        label: 'true',
        kind: CompletionItemKind.Keyword,
        detail: 'Boolean true',
      },
      {
        label: 'false',
        kind: CompletionItemKind.Keyword,
        detail: 'Boolean false',
      },
      {
        label: 'null',
        kind: CompletionItemKind.Keyword,
        detail: 'Null value',
      },
      {
        label: '{}',
        kind: CompletionItemKind.Struct,
        detail: 'Empty object',
        insertText: '{\n  $0\n}',
        insertTextFormat: 2,
      },
      {
        label: '[]',
        kind: CompletionItemKind.Struct,
        detail: 'Empty array',
        insertText: '[\n  $0\n]',
        insertTextFormat: 2,
      },
      {
        label: '""""""',
        kind: CompletionItemKind.Text,
        detail: 'Raw string',
        insertText: '"""\n$0\n"""',
        insertTextFormat: 2,
      },
    ]
  }

  if (context === 'key') {
    return getKnownKeyCompletions(params.textDocument.uri, offset)
  }

  return []
})

function getCompletionContext(
  text: string,
  offset: number,
): 'key' | 'value' | 'unknown' {
  // Walk backwards to figure out context
  let i = offset - 1
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) i--

  if (i >= 0 && text[i] === ':') return 'value'
  if (i >= 0 && text[i] === ',') return 'value'
  if (i >= 0 && text[i] === '[') return 'value'

  // After newline inside an object = key position; inside array = value
  if (i >= 0 && text[i] === '\n') {
    // Find enclosing bracket
    let depth = 0
    for (let j = i; j >= 0; j--) {
      if (text[j] === '}' || text[j] === ']') depth++
      else if (text[j] === '{') {
        if (depth === 0) return 'key'
        depth--
      } else if (text[j] === '[') {
        if (depth === 0) return 'value'
        depth--
      }
    }
  }

  if (i >= 0 && text[i] === '{') return 'key'

  return 'unknown'
}

function getKnownKeyCompletions(
  uri: string,
  _offset: number,
): CompletionItem[] {
  const doc = astCache.get(uri)
  if (!doc) return []

  const keys = new Set<string>()
  collectKeys(doc.value, keys)

  return Array.from(keys).map((key) => ({
    label: key,
    kind: CompletionItemKind.Property,
    detail: 'Known key',
    insertText: `${key}: `,
  }))
}

function collectKeys(node: ValueNode, keys: Set<string>): void {
  if (node.type === 'Object') {
    for (const prop of node.properties) {
      keys.add(prop.key.value)
      collectKeys(prop.value, keys)
    }
  } else if (node.type === 'Array') {
    for (const el of node.elements) {
      collectKeys(el, keys)
    }
  }
}

// --- Hover ---

connection.onHover((params): Hover | null => {
  const doc = astCache.get(params.textDocument.uri)
  if (!doc) return null

  const document = documents.get(params.textDocument.uri)
  if (!document) return null

  const offset = document.offsetAt(params.position)
  const node = findNodeAtOffset(doc.value, offset)
  if (!node) return null

  const typeInfo = getTypeDescription(node)
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: typeInfo,
    },
  }
})

function findNodeAtOffset(
  node: ValueNode,
  offset: number,
): ValueNode | null {
  if (offset < node.span.start.offset || offset >= node.span.end.offset) {
    return null
  }

  if (node.type === 'Object') {
    for (const prop of node.properties) {
      const found = findNodeAtOffset(prop.value, offset)
      if (found) return found
    }
  } else if (node.type === 'Array') {
    for (const el of node.elements) {
      const found = findNodeAtOffset(el, offset)
      if (found) return found
    }
  }

  return node
}

function getTypeDescription(node: ValueNode): string {
  switch (node.type) {
    case 'String':
      return `**String** — \`${truncate(node.value, 50)}\``
    case 'RawString':
      return `**Raw String** — ${node.value.split('\n').length} lines`
    case 'Integer':
      return `**Integer** — \`${node.value}\``
    case 'Float':
      return `**Float** — \`${node.value}\``
    case 'Boolean':
      return `**Boolean** — \`${node.value}\``
    case 'Null':
      return `**Null**`
    case 'Object':
      return `**Object** — ${node.properties.length} ${node.properties.length === 1 ? 'property' : 'properties'}`
    case 'Array':
      return `**Array** — ${node.elements.length} ${node.elements.length === 1 ? 'element' : 'elements'}`
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

// --- Document Symbols ---

connection.onDocumentSymbol((params): DocumentSymbol[] => {
  const doc = astCache.get(params.textDocument.uri)
  if (!doc) return []
  return getSymbols(doc.value)
})

function getSymbols(node: ValueNode): DocumentSymbol[] {
  if (node.type === 'Object') {
    return node.properties.map((prop) => propertyToSymbol(prop))
  }
  if (node.type === 'Array') {
    return node.elements.map((el, i) => elementToSymbol(el, i))
  }
  return []
}

function propertyToSymbol(prop: Property): DocumentSymbol {
  const children = getSymbols(prop.value)
  return {
    name: prop.key.value,
    detail: prop.value.type,
    kind: valueToSymbolKind(prop.value),
    range: spanToRange(prop.span),
    selectionRange: spanToRange(prop.key.span),
    children,
  }
}

function elementToSymbol(node: ValueNode, index: number): DocumentSymbol {
  const children = getSymbols(node)
  return {
    name: `[${index}]`,
    detail: node.type,
    kind: valueToSymbolKind(node),
    range: spanToRange(node.span),
    selectionRange: spanToRange(node.span),
    children,
  }
}

function valueToSymbolKind(node: ValueNode): SymbolKind {
  switch (node.type) {
    case 'Object':
      return SymbolKind.Object
    case 'Array':
      return SymbolKind.Array
    case 'String':
    case 'RawString':
      return SymbolKind.String
    case 'Integer':
    case 'Float':
      return SymbolKind.Number
    case 'Boolean':
      return SymbolKind.Boolean
    case 'Null':
      return SymbolKind.Null
  }
}

function spanToRange(span: { start: { line: number; column: number }; end: { line: number; column: number } }): Range {
  return {
    start: Position.create(Math.max(0, span.start.line - 1), Math.max(0, span.start.column - 1)),
    end: Position.create(Math.max(0, span.end.line - 1), Math.max(0, span.end.column - 1)),
  }
}

// --- Folding Ranges ---

// The MAML AST span.end points to the character AFTER the closing
// delimiter. If that character is a newline, line is incremented and
// column resets to 0. This helper returns the 0-based line of the
// closing delimiter itself (e.g. `}`, `]`, or `"""`).
function endLine0(span: { end: { line: number; column: number } }): number {
  return span.end.column === 0
    ? span.end.line - 2 // delimiter was followed by newline
    : span.end.line - 1
}

connection.onFoldingRanges((params): FoldingRange[] => {
  const doc = astCache.get(params.textDocument.uri)
  if (!doc) return []

  const ranges: FoldingRange[] = []
  collectFoldingRanges(doc.value, ranges)
  collectCommentFoldingRanges(doc, ranges)
  return ranges
})

function collectFoldingRanges(
  node: ValueNode,
  ranges: FoldingRange[],
): void {
  if (node.type === 'Object' || node.type === 'Array') {
    const startLine = node.span.start.line - 1
    const endLine = endLine0(node.span)
    if (endLine > startLine) {
      ranges.push({ startLine, endLine, kind: FoldingRangeKind.Region })
    }
  }

  if (node.type === 'Object') {
    for (const prop of node.properties) {
      collectFoldingRanges(prop.value, ranges)
    }
  } else if (node.type === 'Array') {
    for (const el of node.elements) {
      collectFoldingRanges(el, ranges)
    }
  }

  if (node.type === 'RawString') {
    const startLine = node.span.start.line - 1
    const endLine = endLine0(node.span)
    if (endLine > startLine) {
      ranges.push({ startLine, endLine, kind: FoldingRangeKind.Region })
    }
  }
}

function collectCommentFoldingRanges(
  doc: Document,
  ranges: FoldingRange[],
): void {
  const commentLines: number[] = []
  gatherCommentLines(doc, commentLines)
  if (commentLines.length < 2) return

  commentLines.sort((a, b) => a - b)

  // Group consecutive comment lines
  let groupStart = commentLines[0]
  let prev = commentLines[0]
  for (let i = 1; i < commentLines.length; i++) {
    if (commentLines[i] === prev + 1) {
      prev = commentLines[i]
    } else {
      if (prev > groupStart) {
        ranges.push({
          startLine: groupStart,
          endLine: prev,
          kind: FoldingRangeKind.Comment,
        })
      }
      groupStart = commentLines[i]
      prev = commentLines[i]
    }
  }
  if (prev > groupStart) {
    ranges.push({
      startLine: groupStart,
      endLine: prev,
      kind: FoldingRangeKind.Comment,
    })
  }
}

function gatherCommentLines(doc: Document, lines: number[]): void {
  for (const c of doc.leadingComments) lines.push(c.span.start.line - 1)
  for (const c of doc.trailingComments) lines.push(c.span.start.line - 1)
  gatherCommentLinesFromValue(doc.value, lines)
}

function gatherCommentLinesFromValue(
  node: ValueNode,
  lines: number[],
): void {
  if (node.type === 'Object') {
    for (const c of node.innerComments) lines.push(c.span.start.line - 1)
    for (const prop of node.properties) {
      for (const c of prop.leadingComments) lines.push(c.span.start.line - 1)
      if (prop.trailingComment) lines.push(prop.trailingComment.span.start.line - 1)
      gatherCommentLinesFromValue(prop.value, lines)
    }
  } else if (node.type === 'Array') {
    for (const c of node.innerComments) lines.push(c.span.start.line - 1)
    for (const el of node.elements) {
      gatherCommentLinesFromValue(el, lines)
    }
  }
}

// --- Formatting ---

connection.onDocumentFormatting((params): TextEdit[] => {
  const doc = astCache.get(params.textDocument.uri)
  if (!doc) return []

  const document = documents.get(params.textDocument.uri)
  if (!document) return []

  const formatted = print(doc) + '\n'
  const text = document.getText()
  if (formatted === text) return []

  return [
    TextEdit.replace(
      Range.create(
        Position.create(0, 0),
        document.positionAt(text.length),
      ),
      formatted,
    ),
  ]
})

documents.listen(connection)
connection.listen()
