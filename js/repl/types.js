// @flow

export type BabelPresets = Array<string | Array<string | Object>>;
export type BabelPlugins = Array<string>;

export type EnvConfig = {
  browsers: string,
  electron: ?string,
  isEnvPresetEnabled: boolean,
  isElectronEnabled: boolean,
  isBuiltInsEnabled: boolean,
  isNodeEnabled: boolean,
  isSpecEnabled: boolean,
  isLooseEnabled: boolean,
  builtIns: string | false,
  forceAllTransforms: boolean,
  shippedProposals: boolean,
  version?: any,
  node: ?string,
};

export type EnvFeatures = {
  [feature: string]: Array<number>,
};

export type LoadScriptCallback = (success: boolean) => void;

export type PluginConfig = {
  baseUrl?: string,
  isPreLoaded?: boolean,
  label: string,
  package: string,
  version?: any,
  instanceName?: string,
  files?: Array<string>,
};

export type MultiPackagesConfig = PluginConfig & {
  packages: Array<PluginConfig>,
};

export type PluginConfigs = Array<PluginConfig>;

export type LazyLoadedState = {
  didError: boolean,
  isLoaded: boolean,
  isLoading: boolean,
  config: Object,
};

export type BabelState = LazyLoadedState & {
  availablePresets: Array<any>,
  build: any,
  errorMessage?: string,
  circleciRepo: string,
  config: PluginConfig,
  version: any,
};

export type EnvState = LazyLoadedState & {
  availablePresets: Array<any>,
  build: number,
  errorMessage?: string,
  circleciRepo: string,
  config: PluginConfig,
  version: any,
  isEnabled: boolean,
};

export type ShippedProposalsState = LazyLoadedState & {
  errorMessage?: string,
  config: MultiPackagesConfig,
  isEnabled: boolean,
};

export type PluginState = LazyLoadedState & {
  config: PluginConfig,
  isEnabled: boolean,
};

export type PluginStateMap = { [name: string]: PluginState };

export type SourceType = "script" | "module" | "unambiguous";

export type CompileConfig = {
  debugEnvPreset: boolean,
  envConfig: ?EnvConfig,
  evaluate: boolean,
  presets: BabelPresets,
  plugins: BabelPlugins,
  prettify: boolean,
  sourceMap: boolean,
  sourceType: SourceType,
};

export type ReplState = {
  babili: boolean,
  browsers: string,
  build: string,
  builtIns: string | boolean,
  spec: boolean,
  loose: boolean,
  circleciRepo: string,
  code: string,
  debug: boolean,
  evaluate: boolean,
  fileSize: boolean,
  sourceType: SourceType,
  forceAllTransforms: boolean,
  shippedProposals: boolean,
  lineWrap: boolean,
  presets: ?string,
  prettier: boolean,
  showSidebar: boolean,
  targets: string,
  version: any,
  envVersion: string,
};

type BabelPresetTargetsMap = {
  [key: string]: string,
};

type BabelNamedPresetAndTarget = {
  name: string,
  targets: BabelPresetTargetsMap,
};

export type BabelPresetEnvResult = {
  modulePlugin: string,
  polyfills: ?Array<string>,
  polyfillsWithTargets: ?Array<BabelNamedPresetAndTarget>,
  targets: BabelPresetTargetsMap,
  transformations: Array<string>,
  transformationsWithTargets: Array<BabelNamedPresetAndTarget>,
};

export type SidebarTabSection = "env" | "plugins" | "presets" | "settings";

// ####### SANDPACK #######
export type SandpackStatus =
  | "initializing"
  | "installing-dependencies"
  | "transpiling"
  | "evaluating"
  | "running-tests"
  | "idle";

export type TranspilerContext = {
  availablePlugins: Array<{ label: string, isPreLoaded: boolean }>,
  availablePresets: Array<{ label: string, isPreLoaded: boolean }>,
  babelVersion: string,
};

export type SandpackTranspilerContext = {
  [transpiler: string]: Object,
  "babel-loader": {
    availablePlugins: Array<string>,
    availablePresets: Array<string>,
    babelVersion: string,
  },
};

export type SandpackFile = {
  code: string,
};

export type SandpackFiles = {
  [path: string]: SandpackFile,
};

export type SandpackModule = {
  code: string,
  path: string,
};

export type SandpackModuleSource = {
  fileName: string,
  compiledCode: string,
  sourceMap: Object | typeof undefined,
};

export type SandpackModuleError = {
  title: string,
  message: string,
  path: string,
  line: number,
  column: number,
};

export type SandpackTranspiledModule = {
  module: SandpackModule,
  query: string,
  source: SandpackModuleSource | typeof undefined,
  assets: {
    [name: string]: SandpackModuleSource,
  },
  isEntry: boolean,
  isTestFile: boolean,
  childModules: Array<string>,
  /**
   * All extra modules emitted by the loader
   */
  emittedAssets: Array<SandpackModuleSource>,
  initiators: Array<string>,
  dependencies: Array<string>,
  asyncDependencies: Array<string>,
  transpilationDependencies: Array<string>,
  transpilationInitiators: Array<string>,
};

export type SandpackState = {
  entry: string,
  transpiledModules: {
    [id: string]: SandpackTranspiledModule,
  },
};

export type SandpackConsumerProps = {
  bundlerURL?: string | typeof undefined,
  errors: Array<SandpackModuleError>,
  getManagerTranspilerContext: () => Promise<SandpackTranspilerContext>,
  managerState: SandpackState,
  managerStatus: SandpackStatus,
};
