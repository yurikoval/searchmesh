import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { PROVIDER_LIMITS } from './schema.js';
export function parseProviderYaml(file, bytes) {
    const fail = (code, message, path = '') => ({ ok: false, errors: [{ file, path, code, message }] });
    if (bytes.byteLength > PROVIDER_LIMITS.sourceBytes)
        return fail('source_too_large', 'Source file exceeds the size limit');
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
        return fail('invalid_encoding', 'UTF-8 byte order marks are not allowed');
    let source;
    try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch {
        return fail('invalid_encoding', 'Source must be valid UTF-8');
    }
    if (/\0|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(source))
        return fail('invalid_control_character', 'Source contains a disallowed control character');
    let document;
    try {
        document = parseDocument(source, { schema: 'core', strict: true, uniqueKeys: true, merge: false });
    }
    catch {
        return fail('malformed_yaml', 'YAML could not be parsed');
    }
    if (document.errors.length)
        return fail('malformed_yaml', 'YAML could not be parsed');
    if (document.contents === null || !isMap(document.contents))
        return fail('invalid_root', 'YAML root must be a mapping');
    let nodes = 0;
    let issue;
    const visit = (node, path, depth) => {
        if (!node || issue)
            return;
        nodes += 1;
        if (nodes > PROVIDER_LIMITS.nodes) {
            issue = fail('too_many_nodes', 'YAML exceeds the node limit', path);
            return;
        }
        if (depth > PROVIDER_LIMITS.depth) {
            issue = fail('too_deep', 'YAML exceeds the depth limit', path);
            return;
        }
        if (isAlias(node)) {
            issue = fail('alias_not_allowed', 'YAML aliases are not allowed', path);
            return;
        }
        if (node.tag && !['tag:yaml.org,2002:map', 'tag:yaml.org,2002:seq', 'tag:yaml.org,2002:str', 'tag:yaml.org,2002:null', 'tag:yaml.org,2002:bool', 'tag:yaml.org,2002:int', 'tag:yaml.org,2002:float'].includes(node.tag)) {
            issue = fail('tag_not_allowed', 'Custom YAML tags are not allowed', path);
            return;
        }
        if (isScalar(node)) {
            if (typeof node.value === 'number' && !Number.isFinite(node.value))
                issue = fail('invalid_number', 'Numbers must be finite', path);
            if (node.value instanceof Date || !['string', 'number', 'boolean', 'object'].includes(typeof node.value))
                issue = fail('unsupported_scalar', 'Scalar type is not supported', path);
            return;
        }
        if (isSeq(node)) {
            if (node.items.length > PROVIDER_LIMITS.listItems) {
                issue = fail('list_too_large', 'YAML list exceeds the item limit', path);
                return;
            }
            node.items.forEach((item, index) => visit(item, path ? `${path}.${index}` : String(index), depth + 1));
            return;
        }
        if (isMap(node)) {
            if (node.items.length > PROVIDER_LIMITS.mapKeys) {
                issue = fail('map_too_large', 'YAML mapping exceeds the key limit', path);
                return;
            }
            for (const pair of node.items) {
                if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
                    issue = fail('invalid_key', 'YAML mapping keys must be strings', path);
                    return;
                }
                if (pair.key.value === '<<') {
                    issue = fail('merge_not_allowed', 'YAML merge keys are not allowed', path);
                    return;
                }
                const childPath = path ? `${path}.${node.items.indexOf(pair)}` : String(node.items.indexOf(pair));
                visit(pair.value, childPath, depth + 1);
            }
        }
    };
    visit(document.contents, '', 0);
    if (issue)
        return issue;
    try {
        const value = document.toJS({ maxAliasCount: 0 });
        return { ok: true, value };
    }
    catch {
        return fail('malformed_yaml', 'YAML could not be converted safely');
    }
}
