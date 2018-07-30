// @flow

import "regenerator-runtime/runtime";

import { css, keyframes } from "emotion";
import debounce from "lodash.debounce";
import React from "react";
import {
  SandpackConsumer,
  SandpackProvider,
} from "react-smooshpack/es/components";
import semver from "semver";

import { getCodeSize, getEnvPresetOptions } from "./Utils";
import ErrorBoundary from "./ErrorBoundary";
import { loadBuildArtifacts, loadLatestBuildNumberForBranch } from "./CircleCI";
import ReplEditor from "./ReplEditor";
import ReplLoader from "./ReplLoader";
import ReplOptions from "./ReplOptions";
import StorageService from "./StorageService";
import UriUtils from "./UriUtils";
import loadBuild from "./loadBuild";

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
  SandpackConsumerProps,
  SandpackStatus,
} from "./types";

type Props = {};
type State = {
  babel: BabelState,
  code: string,
  config: {
    error: ?string,
    ready: boolean,
    transpilerUrl: ?string,
    buildArtifacts: Object,
  },
  debugEnvPreset: boolean,
  envConfig: EnvConfig,
  envPresetDebugInfo: ?string,
  envPresetState: EnvState,
  shippedProposalsState: ShippedProposalsState,
  evalEnabled: boolean,
  evalErrorMessage: ?string,
  fileSize: boolean,
  sourceType: SourceType,
  isSidebarExpanded: boolean,
  lineWrap: boolean,
  plugins: PluginStateMap,
  presets: Array<string>,
  sourceMap: ?string,
  userPlugins: { [name: string]: string },
};

class Repl extends React.Component<Props, State> {
  _numLoadingPlugins = 0;

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

    // TODO: temporary
    const presets = persistedPresets.filter(p => p && p !== "env");

    const envConfig = persistedStateToEnvConfig(persistedState);

    // TODO: cleanup/move to unstated
    this.state = {
      babel: persistedStateToBabelState(persistedState, babelConfig),
      code: persistedState.code,
      config: {
        buildArtifacts: {},
        ready: false,
        transpilerUrl: undefined,
        error: null,
      },
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
      fileSize: persistedState.fileSize,
      sourceType: persistedState.sourceType,
      isSidebarExpanded: persistedState.showSidebar,
      lineWrap: persistedState.lineWrap,
      plugins: configArrayToStateMap(pluginConfigs, defaultPlugins),
      presets,
      shippedProposalsState: persistedStateToShippedProposalsState(
        persistedState,
        shippedProposalsConfig,
        envConfig.isEnvPresetEnabled && envConfig.shippedProposals
      ),
      sourceMap: null,
      loadingExternalPlugins: false,
      userPlugins: {},
    };
  }

  componentDidMount() {
    this.setupBabel();
  }

  handleUserPluginChange = userPlugins => {
    this.setState({ userPlugins });
  };

  renderOptions = ({ availablePresets }) => {
    const state = this.state;

    // TODO(bng): this is super temporary... we need to generally clean up
    // all the preset/plugin state stuff, as the order of operations has
    // changed from being:
    //
    // props -> load babel -> get context -> convert to state -> compile
    //
    // to:
    //
    // props -> sandpack compiles -> get babel context -> deal with result
    const presets = configArrayToStateMap(
      availablePresets,
      state.presets.reduce((result, p) => {
        result[p] = true;
        return result;
      }, {})
    );

    return (
      <ReplOptions
        className={styles.optionsColumn}
        debugEnvPreset={state.debugEnvPreset}
        envConfig={state.envConfig}
        envPresetState={state.envPresetState}
        evalEnabled={state.evalEnabled}
        shippedProposalsState={state.shippedProposalsState}
        fileSize={state.fileSize}
        isExpanded={state.isSidebarExpanded}
        lineWrap={state.lineWrap}
        onEnvPresetSettingChange={this._onEnvPresetSettingChange}
        onIsExpandedChange={this._onIsSidebarExpandedChange}
        onSettingChange={this._onSettingChange}
        onExternalPluginRemove={this.handleRemoveExternalPlugin}
        onUserPluginChange={this.handleUserPluginChange}
        pluginState={state.plugins}
        presetState={presets}
        userPlugins={state.userPlugins}
      />
    );
  };

  render() {
    const { code, config, evalEnabled, fileSize, lineWrap } = this.state;

    if (!config.ready) {
      const message = config.error || "Initializing...";
      return <ReplLoader isLoading={false} message={message} />;
    }

    const { files, dependencies } = this.mapStateToConfigs();

    return (
      <SandpackProvider
        files={files}
        className={styles.repl}
        dependencies={dependencies}
        entry="/index.js"
        skipEval={!evalEnabled}
      >
        <SandpackConsumer>
          {(sandpackProps: SandpackConsumerProps) => (
            <ReplEditor
              {...sandpackProps}
              code={code}
              lineWrap={lineWrap}
              onCodeChange={this._updateCode}
              renderSidebar={this.renderOptions}
              showFileSize={fileSize}
            />
          )}
        </SandpackConsumer>
      </SandpackProvider>
    );
  }

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

  _onSettingChange = (name: string, value: any) => {
    this.setState(state => {
      const { plugins, presets } = state;

      if (name === "presets") {
        return {
          presets: value,
        };
      } else if (state.hasOwnProperty(name)) {
        return {
          [name]: value,
        };
      } else if (plugins.hasOwnProperty(name)) {
        plugins[name].isEnabled = !!value;
        return {
          plugins,
        };
      }
    }, this._pluginsUpdatedSetStateCallback);
  };

  _persistState = () => {
    const { state } = this;
    const { envConfig, plugins } = state;

    const presetsArray = this.state.presets.slice();

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
      spec: envConfig.isSpecEnabled,
      loose: envConfig.isLooseEnabled,
      circleciRepo: state.babel.circleciRepo,
      code: state.code,
      debug: state.debugEnvPreset,
      forceAllTransforms: envConfig.forceAllTransforms,
      shippedProposals: envConfig.shippedProposals,
      evaluate: state.evalEnabled,
      fileSize: state.fileSize,
      sourceType: state.sourceType,
      lineWrap: state.lineWrap,
      presets: presetsArray.join(","),
      prettier: plugins.prettier.isEnabled,
      showSidebar: state.isSidebarExpanded,
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

  mapStateToConfigs() {
    const {
      code,
      config,
      envConfig,
      envPresetState,
      evalEnabled,
      presets: requestedPresets,
      userPlugins,
    } = this.state;

    const useScoped = true;

    const packageDeps = {};
    console.log(envConfig, envPresetState);
    // To simplify things, if `build` is passed, then we assume scoped packages,
    // as the main use-case for this is for allowing the REPL to test PRs.

    // TODO: handle parsing version from query string
    // if (babel.version) {}

    const getConfigNameFromKey = (key, scopeNeeded) => {
      return scopeNeeded ? `@babel/preset-${key}` : key;
    };

    const getPackageNameFromKey = (key, scopeNeeded) => {
      return scopeNeeded ? `@babel/preset-${key}` : `babel-preset-${key}`;
    };

    // TODO: handle 3rd party presets?
    const plugins = [];
    const presets = requestedPresets.slice();

    if (envConfig.isEnvPresetEnabled) {
      presets.push(getConfigNameFromKey("env", useScoped));

      Object.keys(getEnvPresetOptions(envConfig))
        .map(getConfigNameFromKey)
        .forEach(configName => presets.push(configName));

      // if (!envConfig.build) {}

      // let packageVersion = "*";

      // const requestedEnvVersion = envPresetState.version;
      // if (envPresetState.build) {
      //   packageVersion = "*";
      // } if (requestedEnvVersion) {
      //   packageVersion = requestedEnvVersion;
      // } else if (useScoped) {
      //   packageVersion = version;
      // } else if (semver.satisfies(version, "^6")) {
      //   packageVersion = "1.6.1";
      // }

      // packageDeps[getPackageNameFromKey("env", useScoped)] = packageVersion;
    }

    Object.keys(userPlugins).forEach(plugin => {
      plugins.push(plugin);
      packageDeps[plugin] = userPlugins[plugin];
    });

    const files = {};

    files["/.babelrc"] = {
      code: JSON.stringify(
        {
          // TODO: handle state.externalPlugins
          plugins,
          presets,
          sourceMaps: evalEnabled,
        },
        null,
        2
      ),
    };

    files["/index.js"] = {
      code,
    };

    if (config.buildArtifacts) {
      const items = {
        babelURL: config.buildArtifacts.babelStandalone,
      };

      if (envConfig.isEnvPresetEnabled) {
        items.babelEnvURL = config.buildArtifacts.envStandalone;
      }

      files["/babel-transpiler.json"] = {
        code: JSON.stringify(items, null, 2),
      };
    }

    return {
      dependencies: packageDeps,
      files,
    };
  }

  // If we're loading a specific build/version of Babel, like from a
  // CircleCI artifact, then we need to generate a config file to let
  // Sandpack know to use it instead of its default.
  async setupBabel() {
    let buildArtifacts;

    try {
      buildArtifacts = await loadBuild(
        this.state.babel.build,
        this.state.babel.circleciRepo
      );
    } catch (ex) {
      this.setState({
        config: {
          error: ex.message,
        },
      });

      return;
    }

    this.setState({
      config: {
        ...this.state.config,
        buildArtifacts,
        ready: true,
      },
    });
  }

  _updateCode = (code: string) => {
    this.setState({ code }, this._persistState);
  };

  handleRemoveExternalPlugin = (pluginName: string) => {
    this.setState(
      state => ({
        externalPlugins: state.externalPlugins.filter(p => p !== pluginName),
      }),
      this._pluginsUpdatedSetStateCallback
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
