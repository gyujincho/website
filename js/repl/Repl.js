// @flow

import "regenerator-runtime/runtime";

import { css } from "emotion";
import debounce from "lodash.debounce";
import React from "react";
import {
  SandpackConsumer,
  SandpackProvider,
} from "react-smooshpack/es/components";
import semver from "semver";
import { buildCodeSandboxFiles } from "./codesandbox";
import ErrorBoundary from "./ErrorBoundary";
import CodeMirrorPanel from "./CodeMirrorPanel";
import ReplEditor from "./ReplEditor";
import ReplOptions from "./ReplOptions";
import StorageService from "./StorageService";
import UriUtils from "./UriUtils";
import { getCodeSize, getEnvPresetOptions } from "./Utils";
import loadBundle from "./loadBundle";
import loadPlugin from "./loadPlugin";
import PresetLoadingAnimation from "./PresetLoadingAnimation";
import {
  babelConfig,
  envPresetConfig,
  shippedProposalsConfig,
  pluginConfigs,
  runtimePolyfillConfig,
} from "./PluginConfig";
import {
  envConfigToTargetsString,
  replState,
  configArrayToStateMap,
  configToState,
  persistedStateToBabelState,
  persistedStateToEnvState,
  persistedStateToEnvConfig,
  persistedStateToShippedProposalsState,
} from "./replUtils";
import WorkerApi from "./WorkerApi";
import scopedEval from "./scopedEval";
import { colors, media } from "./styles";

import type {
  BabelPresets,
  BabelState,
  EnvState,
  ShippedProposalsState,
  EnvConfig,
  PluginState,
  PluginStateMap,
  SourceType,
} from "./types";

type Props = {};
type State = {
  babel: BabelState,
  code: string,
  compiled: ?string,
  compileErrorMessage: ?string,
  debugEnvPreset: boolean,
  envConfig: EnvConfig,
  envPresetDebugInfo: ?string,
  envPresetState: EnvState,
  evalEnabled: boolean,
  shippedProposalsState: ShippedProposalsState,
  evalErrorMessage: ?string,
  fileSize: boolean,
  sourceType: SourceType,
  isEnvPresetTabExpanded: boolean,
  isPluginsExpanded: boolean,
  isPresetsTabExpanded: boolean,
  isSettingsTabExpanded: boolean,
  isSidebarExpanded: boolean,
  lineWrap: boolean,
  meta: Object,
  plugins: PluginStateMap,
  presets: PluginStateMap,
  runtimePolyfillState: PluginState,
  sourceMap: ?string,
  externalPlugins: Array<string>,
  pluginSearch: ?string,
  version: number,
  showOfficialExternalPlugins: boolean,
  loadingExternalPlugins: boolean,
};

const DEBOUNCE_DELAY = 500;

function toCamelCase(str) {
  return str
    .replace(/-/g, " ")
    .replace(/\//g, "_")
    .replace(/@/g, "_")
    .replace(/\s(.)/g, function($1) {
      return $1.toUpperCase();
    })
    .replace(/\s/g, "")
    .replace(/^(.)/, function($1) {
      return $1.toLowerCase();
    });
}

class Repl extends React.Component<Props, State> {
  _numLoadingPlugins = 0;
  _workerApi = new WorkerApi();

  constructor(props: Props, context: any) {
    super(props, context);

    const persistedState = replState();
    const defaultPlugins = {
      "babili-standalone": persistedState.babili,
      prettier: persistedState.prettier,
    };

    const persistedPresets = persistedState.presets
      ? persistedState.presets.split(",")
      : [];

    const presets = [];
    let isEnvTabExpanded = false;
    let isPresetsTabExpanded = false;

    // TODO(bng): temporary
    persistedPresets.forEach(p => {
      if (!p) return;

      if (p === "env") {
        if (!isEnvTabExpanded) {
          isEnvTabExpanded = true;
        }
      } else {
        if (!isPresetsTabExpanded) {
          isPresetsTabExpanded = true;
        }

        presets.push(p);
      }
    });

    const envConfig = persistedStateToEnvConfig(persistedState);

    // A partial State is defined first b'c this._compile needs it.
    // The compile helper will then populate the missing State values.
    this.state = {
      babel: persistedStateToBabelState(persistedState, babelConfig),
      code: persistedState.code,
      compiled: null,
      compileErrorMessage: null,
      debugEnvPreset: persistedState.debug,
      envConfig,
      envPresetDebugInfo: null,
      envPresetState: persistedStateToEnvState(
        persistedState,
        envPresetConfig,
        envConfig.isEnvPresetEnabled
      ),
      evalEnabled: false,
      evalErrorMessage: null,
      externalPlugins: [],
      fileSize: persistedState.fileSize,
      isSidebarExpanded: persistedState.showSidebar,
      lineWrap: persistedState.lineWrap,
      meta: {
        compiledSize: 0,
        rawSize: 0,
      },
      plugins: configArrayToStateMap(pluginConfigs, defaultPlugins),
      pluginSearch: "",
      presets,
      shippedProposalsState: persistedStateToShippedProposalsState(
        persistedState,
        shippedProposalsConfig,
        envConfig.isEnvPresetEnabled && envConfig.shippedProposals
      ),
      showOfficialExternalPlugins: false,
      sourceMap: null,
    };
  }

  render() {
    const { code, evalEnabled, fileSize, lineWrap } = this.state;

    const { babelrc, packageDeps } = this.mapStateToConfigs();
    const files = buildCodeSandboxFiles(code, babelrc);
    console.log(5, files);

    return (
      <SandpackProvider
        files={files}
        dependencies={packageDeps}
        className={styles.repl}
        entry="/index.js"
        skipEval={!evalEnabled}
        template="custom"
      >
        <SandpackConsumer>
          {sandpackProps => (
            <ReplEditor
              {...sandpackProps}
              code={code}
              lineWrapping={lineWrap}
              onCodeChange={this._updateCode}
              renderSidebar={this.renderOptions}
              showFileSize={fileSize}
            />
          )}
        </SandpackConsumer>
      </SandpackProvider>
    );
  }

  _pluginSearch = value => this.setState({ pluginSearch: value });

  _pluginChange = plugin => {
    //this.setState({ loadingExternalPlugins: true });

    if (!this.state.externalPlugins.some(e => e.name === plugin.name)) {
      this.setState(state => ({
        externalPlugins: [...state.externalPlugins, plugin],
      }));
    }
  };

  _showOfficialExternalPluginsChanged = () =>
    this.setState(state => ({
      showOfficialExternalPlugins: !state.showOfficialExternalPlugins,
    }));

  _onEnvPresetSettingChange = (name: string, value: any) => {
    this.setState(
      state => ({
        envConfig: {
          ...state.envConfig,
          [name]: value,
        },
      }),
      this._pluginsUpdatedSetStateCallback
    );
  };

  _onIsSidebarExpandedChange = (isExpanded: boolean) => {
    this.setState(
      {
        isSidebarExpanded: isExpanded,
      },
      this._persistState
    );
  };

  _onSettingChange = (name: string, value: boolean | string) => {
    this.setState(state => {
      const { plugins, presets, runtimePolyfillState } = state;

      if (name === "babel-polyfill") {
        runtimePolyfillState.isEnabled = value;

        return {
          runtimePolyfillState,
        };
      } else if (state.hasOwnProperty(name)) {
        return {
          [name]: value,
        };
      } else if (plugins.hasOwnProperty(name)) {
        plugins[name].isEnabled = value;

        return {
          plugins,
        };
      } else if (presets.hasOwnProperty(name)) {
        presets[name].isEnabled = value;

        return {
          presets,
        };
      }
    }, this._pluginsUpdatedSetStateCallback);
  };

  _persistState = () => {
    const { state } = this;
    const { envConfig, plugins } = state;

    const presetsArray = this._presetsToArray();

    const babili = state.plugins["babili-standalone"];
    if (babili.isEnabled) {
      presetsArray.push("babili");
    }

    if (envConfig.isEnvPresetEnabled) {
      presetsArray.push("env");
    }

    const builtIns = envConfig.isBuiltInsEnabled && envConfig.builtIns;

    const payload = {
      babili: plugins["babili-standalone"].isEnabled,
      browsers: envConfig.browsers,
      build: state.babel.build,
      builtIns: builtIns,
      circleciRepo: state.babel.circleciRepo,
      code: state.code,
      debug: state.debugEnvPreset,
      evaluate: state.evalEnabled,
      forceAllTransforms: envConfig.forceAllTransforms,
      fileSize: state.fileSize,
      isEnvPresetTabExpanded: state.isEnvPresetTabExpanded,
      isPluginsExpanded: state.isPluginsExpanded,
      isPresetsTabExpanded: state.isPresetsTabExpanded,
      isSettingsTabExpanded: state.isSettingsTabExpanded,
      lineWrap: state.lineWrap,
      loose: envConfig.isLooseEnabled,
      presets: presetsArray.join(","),
      prettier: plugins.prettier.isEnabled,
      shippedProposals: envConfig.shippedProposals,
      showSidebar: state.isSidebarExpanded,
      sourceType: state.sourceType,
      spec: envConfig.isSpecEnabled,
      targets: envConfigToTargetsString(envConfig),
      version: state.babel.version,
      envVersion: state.envPresetState.version,
    };

    StorageService.set("replState", payload);
    UriUtils.updateQuery(payload);
  };

  _pluginsUpdatedSetStateCallback = () => {
    this._updateCode(this.state.code);
  };

  _presetsToArray(state: State = this.state): BabelPresets {
    const { presets } = state;

    return Object.keys(presets)
      .filter(key => presets[key].isEnabled && presets[key].isLoaded)
      .map(key => presets[key].config.label);
  }

  _updateCode = (code: string) => this.setState({ code });

  handleRemoveExternalPlugin = (pluginName: string) => {
    this.setState(
      state => ({
        externalPlugins: state.externalPlugins.filter(p => p !== pluginName),
      }),
      this._pluginsUpdatedSetStateCallback
    );
  };

  mapStateToConfigs(
    {
      babel,
      envConfig,
      envPresetState,
      evalEnabled,
      externalPlugins,
      presets: requestedPresets,
    }: State = this.state
  ) {
    console.log(1, this.state);
    const plugins = [];
    const packageDeps = {
      assert: "latest", // Needed by smooshpack
    };

    const requestedBabelVersion = babel.version || "7.0.0-beta.51";
    const scopeNeeded = semver.gte(requestedBabelVersion, "7.0.0-beta.5");

    const getPackageNameFromKey = (key, scopeNeeded) =>
      scopeNeeded ? `@babel/${key}` : `babel-${key}`;

    packageDeps[
      getPackageNameFromKey("core", scopeNeeded)
    ] = requestedBabelVersion;

    const presets = [];

    requestedPresets.forEach(key => {
      const pkg = getPackageNameFromKey(`preset-${key}`, scopeNeeded);
      packageDeps[pkg] = requestedBabelVersion;
      presets.push(pkg);
    });

    externalPlugins.forEach(p => {
      packageDeps[p.name] = p.version;
      plugins.push(p.name);
    });

    if (envConfig.isEnvPresetEnabled) {
      const envPackage = getPackageNameFromKey("preset-env", scopeNeeded);

      presets.push([envPackage, getEnvPresetOptions(envConfig)]);

      let packageVersion;
      const requestedEnvVersion = envPresetState.version;

      if (requestedEnvVersion) {
        packageVersion = requestedEnvVersion;
      } else if (scopeNeeded) {
        packageVersion = requestedBabelVersion;
      } else if (semver.satisfies(requestedBabelVersion, "^6")) {
        packageVersion = "1.6.1";
      }

      packageDeps[envPackage] = packageVersion;
    }

    const babelrc = {
      plugins,
      presets: presets,
      sourceMaps: evalEnabled,
    };

    return {
      babelrc,
      packageDeps,
    };
  }

  renderOptions = () => {
    const state = this.state;

    return (
      <ReplOptions
        babelVersion={state.babel.version}
        className={styles.optionsColumn}
        debugEnvPreset={state.debugEnvPreset}
        envConfig={state.envConfig}
        envPresetState={state.envPresetState}
        evalEnabled={state.evalEnabled}
        externalPlugins={state.externalPlugins}
        fileSize={state.fileSize}
        isExpanded={state.isSidebarExpanded}
        lineWrap={state.lineWrap}
        loadingExternalPlugins={state.loadingExternalPlugins}
        onEnvPresetSettingChange={this._onEnvPresetSettingChange}
        onExternalPluginRemove={this.handleRemoveExternalPlugin}
        onIsExpandedChange={this._onIsSidebarExpandedChange}
        onSettingChange={this._onSettingChange}
        pluginState={state.plugins}
        presetState={state.presets}
        pluginChange={this._pluginChange}
        pluginSearch={this._pluginSearch}
        pluginValue={state.pluginSearch}
        shippedProposalsState={state.shippedProposalsState}
        showOfficialExternalPluginsChanged={
          this._showOfficialExternalPluginsChanged
        }
        showOfficialExternalPlugins={state.showOfficialExternalPlugins}
        sourceType={state.sourceType}
      />
    );
  };
}

export default function ReplWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <Repl />
    </ErrorBoundary>
  );
}

const styles = {
  loader: css({
    alignItems: "center",
    background: colors.inverseBackgroundDark,
    color: colors.inverseForegroundLight,
    display: "flex",
    height: "100vh",
    justifyContent: "center",
  }),
  loadingAnimation: css({
    justifyContent: "center",
    margin: "2rem 0 0 0",
  }),
  loaderContent: css({
    margin: "auto",
    textAlign: "center",
  }),
  codeMirrorPanel: css({
    flex: "0 0 50%",
  }),
  optionsColumn: css({
    flex: "0 0 auto",
  }),
  repl: css`
    height: 100%;
    height: calc(100vh - 50px); /* 50px is the header's height */
    width: 100%;
    display: flex;
    flex-direction: row;
    justify-content: stretch;
    overflow: auto;
    font-size: 0.875rem;

    ${media.mediumAndDown} {
      flex-direction: column;
    }
  `,
  panels: css({
    height: "100%",
    width: "100%",
    display: "flex",
    flexDirection: "row",
    justifyContent: "stretch",
    overflow: "auto",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
  }),
};
