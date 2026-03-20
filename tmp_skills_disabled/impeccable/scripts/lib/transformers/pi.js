import path from 'path';
import { cleanDir, ensureDir, writeFile, generateYamlFrontmatter, replacePlaceholders, prefixSkillReferences } from '../utils.js';

/**
 * Pi Transformer (Skills Only)
 *
 * All skills output to .pi/skills/{name}/SKILL.md
 * Frontmatter: name, description, license, compatibility, metadata
 *
 * @param {Array} skills - All skills (including user-invokable ones)
 * @param {string} distDir - Distribution output directory
 * @param {Object} patterns - Design patterns data (unused)
 * @param {Object} options - Optional settings
 * @param {string} options.prefix - Prefix to add to skill names (e.g., 'i-')
 * @param {string} options.outputSuffix - Suffix for output directory (e.g., '-prefixed')
 */
export function transformPi(skills, distDir, patterns = null, options = {}) {
  const { prefix = '', outputSuffix = '' } = options;
  const piDir = path.join(distDir, `pi${outputSuffix}`);
  const skillsDir = path.join(piDir, '.pi/skills');

  cleanDir(piDir);
  ensureDir(skillsDir);

  const allSkillNames = skills.map(s => s.name);
  const commandNames = skills.filter(s => s.userInvokable).map(s => `${prefix}${s.name}`);
  let refCount = 0;
  for (const skill of skills) {
    const skillName = `${prefix}${skill.name}`;
    const skillDir = path.join(skillsDir, skillName);

    const frontmatterObj = {
      name: skillName,
      description: skill.description,
    };

    if (skill.license) frontmatterObj.license = skill.license;
    if (skill.compatibility) frontmatterObj.compatibility = skill.compatibility;
    if (skill.metadata) frontmatterObj.metadata = skill.metadata;

    const frontmatter = generateYamlFrontmatter(frontmatterObj);
    let skillBody = replacePlaceholders(skill.body, 'pi', commandNames);
    if (prefix) skillBody = prefixSkillReferences(skillBody, prefix, allSkillNames);
    const content = `${frontmatter}\n\n${skillBody}`;
    const outputPath = path.join(skillDir, 'SKILL.md');
    writeFile(outputPath, content);

    // Copy reference files if they exist
    if (skill.references && skill.references.length > 0) {
      const refDir = path.join(skillDir, 'reference');
      ensureDir(refDir);
      for (const ref of skill.references) {
        const refOutputPath = path.join(refDir, `${ref.name}.md`);
        const refContent = replacePlaceholders(ref.content, 'pi');
        writeFile(refOutputPath, refContent);
        refCount++;
      }
    }
  }

  const userInvokableCount = skills.filter(s => s.userInvokable).length;
  const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
  const prefixInfo = prefix ? ` [${prefix}prefixed]` : '';
  console.log(`✓ Pi${prefixInfo}: ${skills.length} skills (${userInvokableCount} user-invokable)${refInfo}`);
}
