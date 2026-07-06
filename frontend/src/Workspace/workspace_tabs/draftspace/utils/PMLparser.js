/**
 * Parses a PM‑Lite markup string and returns a ProseMirror document JSON.
 * @param {string} input - The PM‑Lite formatted text.
 * @returns {Object} A ProseMirror doc node ({ type: 'doc', content: [...] }).
 */
export function parsePML(input) {
  
  
  // ----- Helper functions -------------------------------------------------


  // Find first ':' that is not inside double quotes.
  function findTextSeparator(str) {
    let inQuote = false;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '"' && (i === 0 || str[i - 1] !== '\\')) {
        inQuote = !inQuote;
      } else if (str[i] === ':' && !inQuote) {
        return i;
      }
    }
    return -1;
  }









  // Parse attribute tokens (key=value, value may be quoted).
  function parseAttributes(attrString) {
    const attrs = {};
    if (!attrString.trim()) return attrs;
    const regex = /(\w[\w-]*)=(?:"([^"\\]*(?:\\.[^"\\]*)*)"|(\S+))/g;
    let match;
    while ((match = regex.exec(attrString)) !== null) {
      const key = match[1];
      // quoted value (capture group 2) or unquoted (group 3)
      const value = match[2] !== undefined
        ? match[2].replace(/\\"/g, '"')
        : match[3];
      attrs[key] = value;
    }
    return attrs;
  }








  
  
  // Parse a 'marks' attribute value into ProseMirror marks array.
  function parseMarks(markString) {
    if (!markString) return [];
    // Split by comma, respecting parentheses.
    const marks = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < markString.length; i++) {
      const ch = markString[i];
      if (ch === '(') { depth++; current += ch; }
      else if (ch === ')') { depth--; current += ch; }
      else if (ch === ',' && depth === 0) {
        marks.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) marks.push(current.trim());

    return marks.map(m => {
      // Separate mark type and possible attrs in parentheses
      const parenIdx = m.indexOf('(');
      let type, markAttrs = {};
      if (parenIdx !== -1) {
        type = m.slice(0, parenIdx).trim();
        const inner = m.slice(parenIdx + 1, m.lastIndexOf(')')).trim();
        markAttrs = inner ? parseAttributes(inner) : {};
      } else {
        type = m.trim();
      }
      // Build ProseMirror mark object
      const mark = { type };
      if (Object.keys(markAttrs).length > 0) {
        mark.attrs = markAttrs;
      }
      return mark;
    });
  }










  

  // Parse a single line into a node object (without parent/children).
  function parseNodeLine(line, inlineTextAllowed = true) {
    // line must start with '!'
    if (!line.startsWith('!')) throw new Error(`Invalid line: ${line}`);
    const afterBang = line.slice(1);
    const sepIndex = findTextSeparator(afterBang);
    let typeAndAttrs, textContent = null;

    if (sepIndex !== -1) {
      typeAndAttrs = afterBang.slice(0, sepIndex).trim();
      textContent = afterBang.slice(sepIndex + 1).trim();
    } else {
      typeAndAttrs = afterBang.trim();
    }

    // Extract type (first word)
    const spaceIdx = typeAndAttrs.search(/\s/);
    const type = spaceIdx === -1 ? typeAndAttrs : typeAndAttrs.slice(0, spaceIdx);
    const attrsPart = spaceIdx === -1 ? '' : typeAndAttrs.slice(spaceIdx + 1).trim();

    const attrs = parseAttributes(attrsPart);

    // Special handling for '!text' nodes
    if (type === 'text') {
      if (textContent === null) throw new Error('Text node missing content.');
      return {
        type: 'text',
        text: textContent,
        marks: attrs.marks ? parseMarks(attrs.marks) : []
      };
    }

    // Block node
    const node = {
      type,
      attrs: {}  // will be filled with relevant attributes
    };

    // Map allowed attributes per node type (your editor‑specific set)
    if (type === 'heading') {
      if (attrs.level) node.attrs.level = parseInt(attrs.level, 10);
    } else if (type === 'paragraph') {
      if (attrs.align) node.attrs.align = attrs.align;
    } else if (type === 'orderedList') {
      if (attrs.listType) node.attrs.order = attrs.listType;  // ProseMirror uses 'order'
    } else if (type === 'bulletList') {
      // no special attrs
    } else if (type === 'listItem') {
      // no special attrs
    } else {
      // unknown types – keep all attrs for extensibility
      Object.assign(node.attrs, attrs);
    }

    // Determine if this node has children or is a leaf with inline text.
    if (textContent !== null) {
      // Shorthand leaf: single text child without marks.
      node.content = [{
        type: 'text',
        text: textContent
      }];
    } else {
      // Container node: children will be added later.
      node.content = [];
    }

    return node;
  }











  // ----- Main parsing loop -----------------------------------------------

  const lines = input.split('\n');
  const root = { type: 'doc', content: [] };

  // Stack holds objects { node, indent } – indent in number of spaces
  const stack = [{ node: root, indent: -2 }];   // root at virtual indent -2

  for (let rawLine of lines) {
    // Skip completely empty lines.
    if (rawLine.trim() === '') continue;

    // Measure leading spaces (indentation).
    // AFTER
const indent = rawLine.length - rawLine.trimStart().length;
const trimmed = rawLine.trim();   // remove both leading AND trailing whitespace

    // Pop from stack until we find a parent whose indent is strictly less.
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].node;
    const child = parseNodeLine(trimmed);

    // Add child to parent's content.
    parent.content.push(child);

    // If the child is a container (no inline text shorthand and not a text node),
    // push it onto the stack for its own children.
    if (child.type !== 'text' && !('text' in child)) {
      stack.push({ node: child, indent });
    }
    // Note: '!text' nodes never become containers.
  }

  return root         
}        