import path from 'path';
import {
  cleanDir,
  ensureDir,
  generateYamlFrontmatter,
  prefixSkillReferences,
  replacePlaceholders,
  writeFile,
} from '../utils.js';

/**
 * OpenCode Transformer (Skills Only)
 *
 * All skills output to .opencode/skills/{name}/SKILL.md
 * User-invokable skills get args support in frontmatter.
 *
 * @param {Array} skills - All skills (including user-invokable ones)
 * @param {string} distDir - Distribution output directory
 * @param {Object} patterns - Design patterns data (unused, kept for interface consistency)
 * @param {Object} options - Optional settings
 * @param {string} options.prefix - Prefix to add to user-invokable skill names (e.g., 'i-')
 * @param {string} options.outputSuffix - Suffix for output directory (e.g., '-prefixed')
 */
export function transformOpenCode(
  skills,
  distDir,
  patterns = null,
  options = {},
) {
  const { prefix = '', outputSuffix = '' } = options;
  const opencodeDir = path.join(distDir, `opencode${outputSuffix}`);
  const skillsDir = path.join(opencodeDir, '.opencode/skills');

  cleanDir(opencodeDir);
  ensureDir(skillsDir);

  const allSkillNames = skills.map((s) => s.name);
  const commandNames = skills
    .filter((s) => s.userInvokable)
    .map((s) => `${prefix}${s.name}`);
  let refCount = 0;
  for (const skill of skills) {
    const skillName = `${prefix}${skill.name}`;
    const skillDir = path.join(skillsDir, skillName);

    const frontmatterObj = {
      name: skillName,
      description: skill.description,
    };

    if (skill.userInvokable) frontmatterObj['user-invokable'] = true;
    if (skill.args && skill.args.length > 0) frontmatterObj.args = skill.args;
    if (skill.license) frontmatterObj.license = skill.license;
    if (skill.compatibility) frontmatterObj.compatibility = skill.compatibility;
    if (skill.metadata) frontmatterObj.metadata = skill.metadata;
    if (skill.allowedTools)
      frontmatterObj['allowed-tools'] = skill.allowedTools;

    const frontmatter = generateYamlFrontmatter(frontmatterObj);
    let skillBody = replacePlaceholders(skill.body, 'opencode', commandNames);
    if (prefix)
      skillBody = prefixSkillReferences(skillBody, prefix, allSkillNames);
    const content = `${frontmatter}\n\n${skillBody}`;
    const outputPath = path.join(skillDir, 'SKILL.md');
    writeFile(outputPath, content);

    // Copy reference files if they exist
    if (skill.references && skill.references.length > 0) {
      const refDir = path.join(skillDir, 'reference');
      ensureDir(refDir);
      for (const ref of skill.references) {
        const refOutputPath = path.join(refDir, `${ref.name}.md`);
        const refContent = replacePlaceholders(ref.content, 'opencode');
        writeFile(refOutputPath, refContent);
        refCount++;
      }
    }
  }

  const userInvokableCount = skills.filter((s) => s.userInvokable).length;
  const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
  const prefixInfo = prefix ? ` [${prefix}prefixed]` : '';
  console.log(`✓ OpenCode${prefixInfo}: ${skills.length} skills (${userInvokableCount} user-invokable)${refInfo}`);
}
