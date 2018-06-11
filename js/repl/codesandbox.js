// @flow

const replConfig = {
  templateName: "babel-repl",
  templateColor: "#F5DB5F",
  sandpack: {
    defaultExtensions: ["js", "jsx", "ts", "tsx", "json"],
    aliases: {},
    preInstalledDependencies: [],
    transpilers: {
      "\\.jsx?$": ["./transpilers/babel"],
      "\\.json$": ["codesandbox:json"],
      ".*": ["codesandbox:raw"],
    },
  },
};

const transpilerSource = (scopeNeeded: boolean = true) => {
  const core = scopeNeeded ? "@babel/core" : "babel-core";

  return `
import { transform, version } from "${core}";

export const name = 'babel';

export const getTranspilerContext = async () => ({
  availablePlugins: [],
  availablePresets: [],
  babelVersion: version,
});

export async function transpile(code, loaderContext) {
  const newCode = transform(code, {
    filename: "/index.js",
    babelrc: true
  });
  console.log('happens')
  console.log(newCode);

  return { transpiledCode: newCode.code };
}`;
};

export const buildCodeSandboxFiles = (code: string, babelConfig: any) => {
  return {
    "/.codesandbox/template.json": {
      code: JSON.stringify(replConfig),
    },
    "/.codesandbox/transpilers/babel.js": {
      code: transpilerSource(),
    },
    "/index.js": { code },
    "/.babelrc": {
      code: JSON.stringify(babelConfig),
    },
  };
};
