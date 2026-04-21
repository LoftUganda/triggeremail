import Handlebars from "handlebars";
import { writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";

const TEMPLATES_DIR = "./src/precompiled";

mkdirSync(TEMPLATES_DIR, { recursive: true });

const templateFiles = readdirSync(TEMPLATES_DIR).filter(f => f.endsWith(".ts"));

for (const file of templateFiles) {
  const name = file.replace(".ts", "");
  const module = await import(`../precompiled/${file}`);
  const source = module.default;

  const precompiled = Handlebars.precompile(source);
  const js = `export default ${precompiled};`;
  const outPath = join(TEMPLATES_DIR, `${name}.compiled.js`);
  writeFileSync(outPath, js);
  console.log(`Precompiled: ${name} -> ${outPath}`);
}