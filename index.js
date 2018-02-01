const jsone = require('json-e');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const _  = require('lodash');
const rimraf = require('rimraf');
const mkdirp = require('mkdirp');
const axios = require('axios');
require('axios-retry')(axios, {retries: 5});

const input_folder = './';
const manifest_cache = path.join(__dirname, 'manifests');
const MANIFEST_URL = 'https://references.taskcluster.net/manifest.json';

const loadRef = (name) => {
  return JSON.parse(fs.readFileSync(path.join(manifest_cache, `${name}.json`), 'utf8'));
};

const cmds = {};
cmds.transform = () => {
  const context_file = path.join(input_folder, 'context.yml');
  const config = yaml.safeLoad(fs.readFileSync(context_file, 'utf8'));
  const context = Object.assign({}, config, {
    join: (list, sep) => list.join(sep),
    range: (n) => {
      const result = [];
      for (let i = 0; i < n; i++) {
        result.push(i);
      }
      return result;
    },
    projects: config.projects.map(project => {
      const refs = (project.references || []).map(loadRef);
      const methods = _.flatten(refs.map(r =>
        r.entries.filter(e => e.type === 'function').map(e => e.name)
      ));
      const exchanges = _.flatten(refs.map(r =>
        r.entries.filter(e => e.type === 'topic-exchange').map(e => e.exchange)
      ));
      return Object.assign({}, project, {
        methods, exchanges,
        exchangePrefix: refs.map(r => r.exchangePrefix).filter(e => !!e)[0] || '',
      });
    }),
  });
  const input = fs.readdirSync(input_folder).filter(f => /^.+\.tf\.yml$/.test(f));

  for (const filename of input) {
    const template = yaml.safeLoad(fs.readFileSync(path.join(input_folder, filename), 'utf8'));
    const result = jsone(template, context);
    fs.writeFileSync(
      path.join(input_folder, filename.replace(/\.yml$/, '.json')),
      JSON.stringify(result, null, 2),
      'utf8',
    );
  }
};

cmds['update-manifest'] = async () => {
  // Clear cache
  rimraf.sync(manifest_cache);
  mkdirp.sync(manifest_cache);

  // Fetch manifest
  const {data: manifest} = await axios.get(MANIFEST_URL);
  await Promise.all(Object.keys(manifest).map(async (key) => {
    const {data: reference} = await axios.get(manifest[key]);
    fs.writeFileSync(path.join(manifest_cache, `${key}.json`), JSON.stringify(reference, null, 2), 'utf8');
  }));
};

if (!module.parent) {
  const arg = process.argv[2];
  cmd = cmds[arg];
  if (!cmd) {
    console.log(`No such command: ${arg}`);
    console.log(`Try: ${Object.keys(cmds).join(', ')}`);
    process.exit(1);
  }
  cmd();
}
