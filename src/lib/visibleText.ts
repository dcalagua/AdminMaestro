import ts from 'typescript';

/**
 * Textos VISIBLES de un archivo .tsx/.ts, para vigilar el glosario (V5 · F1).
 *
 * Recoge lo que una persona lee en pantalla: texto JSX, props de texto de los
 * componentes (`title`, `description`, `label`…), propiedades de texto en
 * objetos de configuración, mensajes de toast y de validación, y los valores de
 * los diccionarios de etiquetas (`*_LABEL`). Ignora comentarios, clases,
 * rutas, claves de consulta e identificadores de código.
 *
 * Excepciones deliberadas: el atributo `title` de un elemento HTML es un
 * tooltip, y el plan permite que lo técnico para el super admin viva ahí; la
 * prop `source` de los gráficos también termina en un tooltip (`SourceHint`).
 */
export interface VisibleText {
  line: number;
  text: string;
}

const TEXT_PROPS = new Set([
  'title', 'description', 'label', 'placeholder', 'hint', 'message', 'aria-label', 'confirmLabel',
  'detailLabel', 'emptyTitle', 'emptyDescription', 'cancelLabel', 'submitLabel', 'caption', 'subtitle',
  'helper', 'legend', 'text', 'question', 'summary', 'heading', 'badge', 'note', 'footnote',
  'action', 'actionLabel', 'reason', 'tooltip',
  // V6 · T7: la definición y el pie de los KPI también se leen (un tooltip de Costos decía `v_collected_revenue`).
  'info', 'footer', 'context', 'emptyLabel',
]);

const MESSAGE_CALLS = new Set(['success', 'error', 'info', 'warning', 'warn', 'push', 'regex', 'min', 'max', 'refine', 'length']);

const LABEL_MAP = /LABEL|Label|COPY|Copy|TEXT|Text|MESSAGE|Message|HINT|Hint|TITLE|Title/;

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' … ');
  }
  return null;
}

/** Sube por condicionales, `??`, `||`, paréntesis y concatenaciones. */
function valueOwner(node: ts.Node): ts.Node {
  let current = node;
  while (
    current.parent &&
    (ts.isConditionalExpression(current.parent) ||
      ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      (ts.isBinaryExpression(current.parent) &&
        [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(
          current.parent.operatorToken.kind,
        )) ||
      ts.isArrayLiteralExpression(current.parent))
  ) {
    current = current.parent;
  }
  return current;
}

function propName(name: ts.PropertyName | ts.JsxAttributeName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isJsxNamespacedName(name)) return `${name.namespace.text}:${name.name.text}`;
  return '';
}

function isVisible(node: ts.Node): boolean {
  const owner = valueOwner(node);
  const parent = owner.parent;
  if (!parent) return false;

  // <Comp prop="…" /> o <Comp prop={…} />
  const attr = ts.isJsxAttribute(parent)
    ? parent
    : ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)
      ? parent.parent
      : null;
  if (attr) {
    const name = propName(attr.name);
    if (!TEXT_PROPS.has(name)) return false;
    // `title` de un elemento HTML = tooltip: lo técnico para el super admin puede vivir ahí.
    const element = attr.parent.parent;
    const tag = ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) ? element.tagName.getText() : '';
    return !(name === 'title' && /^[a-z]/.test(tag));
  }
  // {cond ? 'texto' : 'otro'} como hijo de un elemento.
  if (ts.isJsxExpression(parent)) return Boolean(parent.parent && (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent)));
  // { label: '…' } en objetos de configuración.
  if (ts.isPropertyAssignment(parent) && parent.initializer === owner) {
    const name = propName(parent.name);
    if (TEXT_PROPS.has(name)) return true;
    // Valores de un diccionario de etiquetas: `const X_LABEL = { CLAVE: 'Texto' }`.
    let scope: ts.Node | undefined = parent.parent;
    while (scope && !ts.isVariableDeclaration(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
    if (!scope || !ts.isVariableDeclaration(scope)) return false;
    // … o un diccionario tipado `Record<…, string>` (códigos → texto).
    return LABEL_MAP.test(scope.name.getText()) || /Record<[^>]*,\s*string>$/.test(scope.type?.getText() ?? '');
  }
  // Tablas de pares en JSX: {[['Etiqueta', valor], …].map(…)}
  if (ts.isPropertyAccessExpression(parent) && parent.name.text === 'map' && ts.isArrayLiteralExpression(owner)) return true;
  // toast.success('…'), toast.push('info', '…'), z.string().regex(RE, '…')
  if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)) {
    return MESSAGE_CALLS.has(parent.expression.name.text);
  }
  // return '…' dentro de una función de etiqueta (`xLabel()`, `describeX()`).
  if (ts.isReturnStatement(parent)) {
    let fn: ts.Node | undefined = parent.parent;
    while (fn && !ts.isFunctionDeclaration(fn) && !ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) fn = fn.parent;
    const fnName =
      fn && ts.isFunctionDeclaration(fn)
        ? fn.name?.text
        : fn?.parent && ts.isVariableDeclaration(fn.parent)
          ? fn.parent.name.getText()
          : undefined;
    return Boolean(fnName && /label|Label|describe|message|Message|text|Text|reason|Reason/.test(fnName));
  }
  return false;
}

export function visibleTexts(fileName: string, source: string): VisibleText[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: VisibleText[] = [];
  const push = (node: ts.Node, text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean) out.push({ line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: clean });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) push(node, node.text);
    else {
      const text = literalText(node);
      if (text !== null && isVisible(node)) push(node, text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/**
 * Quita identificadores de código citados en el texto (`EWM_QAS_M2M_PRIVATE_KEY`,
 * `ewm-provisioning-v1`, `provisioning:tenant:create`): son valores que la
 * persona debe escribir tal cual, no vocabulario.
 */
export function withoutIdentifiers(text: string): string {
  return text.replace(/[\w.]+(?:[_:\-./][\w.]+)+/g, (token) => (token === 'DRY_RUN' || /^(?:one-time|D-\d{2})$/i.test(token) ? token : ' '));
}
