import * as vscode from 'vscode';
import { watch } from "chokidar";
import * as fs from "fs";
import * as path from "path";
import { get, set } from "lodash";

const { Range, Position, Hover } = vscode;

const configurationSection = "i18nHelper";
const translation = {};
let globalWatcher: any;

function getRootPath(): string {
  const folders = vscode.workspace.workspaceFolders;

  if (folders && folders.length) {
    return folders[0].uri.path;
  } else {
    return '';
  }
}

function loadConfig() {
  return vscode.workspace.getConfiguration(configurationSection);
}

function getFolders(dir: string): Promise<string[]> {
  const realDir = path.join(getRootPath(), dir);
  return new Promise((resolve, reject) => {
    fs.readdir(realDir, (err, folders) => {
      if (err) {
        reject([]);
      } else {
        resolve(folders.map(f => f.replace('.json', '')));
      }
    });
  });
}

function loadFile(file: string) {
  return new Promise((resolve, reject) => {
    fs.readFile(file, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

interface ProjectConfig {
  name: string;
  locales: string[];
}

async function loadProjects(configs: Project[]) {
  const result: ProjectConfig[] = [];

  for (const config of configs) {
    result.push({
      name: config.name,
      locales: await getFolders(config.path)
    });
  }

  return result;
}

async function loadTranslation(config: TranslationConfig) {
  const { path, project, locale } = config;
  const fromFile: any = await loadFile(path);

  set(translation, [project!, locale], JSON.parse(fromFile));
}

interface Project {
  name: string;
  path: string;
}

interface TranslationConfig {
  path: string;
  project?: string;
  locale: string;
}
function initWatcher(projects: Project[]) {
  const isWin = process.platform === "win32";
  const SEPERATOR = isWin ? "\\" : "/";
  const paths = projects.map(p => path.join(getRootPath(), p.path));
  const watcher = watch(paths, {
    persistent: true
  });

  const getTranslationConfig = (path: string) => {
    const _path = path.replace(`${getRootPath()}${SEPERATOR}`, "");
    const project = projects.find(p => _path.startsWith(p.path));
    const pathRegex = isWin
      ? project?.path.replace(/\\/g, "\\\\")
      : project?.path.replace(/\//g, "/");
    const fileRegex = isWin ? "\\.json" : ".json";
    const regex = `(?<=${pathRegex}/).+(?=${fileRegex})`;
    const locale = _path.match(new RegExp(regex, "g")) || [""];

    return {
      path,
      project: project?.name,
      locale: locale[0]
    };
  };

  const onEvent = async (path: string) => {
    const config: TranslationConfig = getTranslationConfig(path);
    await loadTranslation(config);
    console.log(`[i18n-helper] ${config.project} ${config.locale} loaded`);
  };

  watcher.on("add", onEvent).on("change", onEvent);

  globalWatcher = watcher;
  return watcher;
}

async function init() {
  const config = loadConfig();

  if (!config.projects) {
    const toast = "`i18nHelper.projects` not found!";
    vscode.window.showInformationMessage(toast);
    return;
  }

  console.log("[i18n-helper] is now active!");
  const projects = await loadProjects(config.projects);
  initWatcher(config.projects);

  vscode.languages.registerHoverProvider(
    ["javascript", "javascriptreact", "typescript", "typescriptreact"],
    {
      provideHover(document, position) {
        const { activeTextEditor } = vscode.window;

        // If there's no activeTextEditor, do nothing.
        if (!activeTextEditor) {
          return;
        }

        const { line, character } = position;

        const start = new Position(
          line,
          character - 50 < 0 ? 0 : character - 50
        );
        const end = new Position(line, character + 50);
        const biggerRange = new Range(start, end);
        const wordInRange = document.getText(biggerRange);

        // string in single quote
        const regex = /'(.*?\..*?)'/g;
        const match = wordInRange.match(regex);

        if (match && match.length) {
          const [str] = match;
          const target = str.replace(`'`, "").replace(`'`, "");
          const getter = config.flatten
            ? [target]
            : target.split(".");

          let markdownStr = "";

          projects.forEach(project => {
            const { name, locales } = project;
            let projectStr = "";
            let translationStr = "";
            locales.forEach(locale => {
              const t = get(translation, [name, locale, ...getter]);
              if (t) {
                translationStr += `|[${locale}]|${t}|\n`;
              }
            });

            if (translationStr.length) {
              projectStr += `|${name}||\n`;
              projectStr += "|:--|:--|\n";
              projectStr += translationStr;
              projectStr += '\n';
            }

            markdownStr += projectStr;
          });

          if (markdownStr) {
            return new Hover(markdownStr);
          } else {
            return;
          }
        }
      }
    }
  );
}

function refersh() {
  if (getRootPath()) {
    init();
  } else {
    destory();
  }
}
function watchFolders() {
  refersh();

  vscode.workspace.onDidChangeWorkspaceFolders(() => {
    refersh();
  });
}
/**
 */
export async function activate() {
  watchFolders();
}

function destory() {
  if (globalWatcher) {
    globalWatcher.close().then(() => console.log("watcher closed"));
  }
}

// this method is called when your extension is deactivated
export function deactivate() {
  destory();
}
