import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const expoRepository = 'https://github.com/expo/expo.git';
const overlayPathInExpo = 'packages/expo/types/react-native-web.d.ts';
const installedOverlayPath = 'node_modules/expo/types/react-native-web.d.ts';
const screenPath = 'src/app/index.tsx';

const cases = [
  { label: 'View className', member: 'className', source: '<View className={className} />' },
  { label: 'Text className', member: 'className', source: '<Text className={className}>' },
  { label: 'FlatList className', member: 'className', source: '<FlatList className={className}' },
  { label: 'Image className', member: 'className', source: '<Image className={className} />' },
  { label: 'Switch className', member: 'className', source: '<Switch className={className} />' },
  {
    label: 'InputAccessoryView className',
    member: 'className',
    source: '<InputAccessoryView className={className}>',
  },
  {
    label: 'TouchableWithoutFeedback className',
    member: 'className',
    source: '<TouchableWithoutFeedback className={className}>',
  },
  { label: 'Text lang', member: 'lang', source: '<Text lang={lang}>' },
  { label: 'View style visibility', member: 'visibility', source: '<View style={{ visibility }} />' },
  { label: 'Text style textOverflow', member: 'textOverflow', source: '<Text style={{ textOverflow }}>' },
];

const exitCodes = { fixed: 0, defectShows: 1, stepFailed: 2 };

class StepFailed extends Error {}

function execute(command, commandArguments, options = {}) {
  const result = spawnSync(command, commandArguments, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error) {
    throw new StepFailed(`${command} ${commandArguments.join(' ')} did not start: ${result.error.message}`);
  }
  return result;
}

function npm(commandArguments) {
  return process.platform === 'win32'
    ? execute(`npm ${commandArguments.join(' ')}`, [], { shell: true })
    : execute('npm', commandArguments);
}

function readInstalledVersion(packageName) {
  return JSON.parse(readFileSync(`node_modules/${packageName}/package.json`, 'utf8')).version;
}

function parseArguments(commandArguments) {
  if (commandArguments.length === 0) {
    return undefined;
  }
  if (commandArguments.length === 2 && commandArguments[0] === '--overlay') {
    return commandArguments[1];
  }
  throw new StepFailed('usage: node repro.mjs [--overlay <path to a react-native-web.d.ts>]');
}

async function readMainOverlay() {
  const lsRemote = execute('git', ['ls-remote', expoRepository, 'refs/heads/main']);
  const commit = lsRemote.stdout.split(/\s/)[0] ?? '';
  if (lsRemote.status !== 0 || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new StepFailed(`git ls-remote ${expoRepository} refs/heads/main failed: ${lsRemote.stderr.trim()}`);
  }
  const url = `https://raw.githubusercontent.com/expo/expo/${commit}/${overlayPathInExpo}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new StepFailed(`GET ${url} answered ${response.status}`);
  }
  return {
    name: `expo main at ${commit.slice(0, 11)}, ${overlayPathInExpo}`,
    content: Buffer.from(await response.arrayBuffer()),
  };
}

function readOverlayUnderTest(overlayArgument) {
  if (overlayArgument === undefined) {
    return readMainOverlay();
  }
  try {
    return { name: overlayArgument, content: readFileSync(overlayArgument) };
  } catch (error) {
    throw new StepFailed(`--overlay ${overlayArgument} could not be read: ${error.message}`);
  }
}

function describeDeclarations(content) {
  const lines = content.toString('utf8').split(/\r?\n/);
  const members = [...new Set(cases.map((testCase) => testCase.member))];
  return members
    .map((member) => {
      const declarationPattern = new RegExp(`^\\s*${member}\\?:\\s*(.+?);?\\s*$`);
      const lineNumbersByDeclaration = new Map();
      lines.forEach((text, index) => {
        const match = declarationPattern.exec(text);
        if (match) {
          const declaration = `${member}?: ${match[1]}`;
          lineNumbersByDeclaration.set(declaration, [
            ...(lineNumbersByDeclaration.get(declaration) ?? []),
            index + 1,
          ]);
        }
      });
      if (lineNumbersByDeclaration.size === 0) {
        return `${member} is not declared`;
      }
      return [...lineNumbersByDeclaration]
        .map(
          ([declaration, lineNumbers]) =>
            `${declaration} (${lineNumbers.length === 1 ? 'line' : 'lines'} ${lineNumbers.join(', ')})`
        )
        .join('; ');
    })
    .join('; ');
}

function locateCases() {
  const lines = readFileSync(screenPath, 'utf8').split(/\r?\n/);
  return cases.map((testCase) => {
    const index = lines.findIndex((text) => text.includes(testCase.source));
    if (index === -1) {
      throw new StepFailed(`${screenPath} has no line with ${testCase.source}`);
    }
    return { ...testCase, line: index + 1 };
  });
}

function parseDiagnostics(output) {
  const diagnostics = [];
  for (const text of output.split(/\r?\n/)) {
    const match = /^(.+?)\((\d+),\d+\): error (TS\d+): /.exec(text);
    if (match) {
      diagnostics.push({ file: match[1], line: Number(match[2]), code: match[3], text });
    } else if (text.trim() !== '' && !text.startsWith(' ')) {
      diagnostics.push({ file: undefined, line: 0, code: undefined, text });
    }
  }
  return diagnostics;
}

function typeCheck(extraArguments) {
  const result = execute(process.execPath, [
    'node_modules/typescript/bin/tsc',
    '--noEmit',
    '--pretty',
    'false',
    ...extraArguments,
  ]);
  const diagnostics = parseDiagnostics(`${result.stdout}\n${result.stderr}`);
  if (result.status === 0 && diagnostics.length === 0) {
    return diagnostics;
  }
  if ((result.status === 1 || result.status === 2) && diagnostics.length > 0) {
    return diagnostics;
  }
  throw new StepFailed(`tsc exited with ${result.status}: ${`${result.stdout}${result.stderr}`.trim()}`);
}

function installDependencies() {
  const install = npm(['ci', '--no-audit', '--no-fund']);
  if (install.status !== 0) {
    throw new StepFailed(`npm ci exited with ${install.status}:\n${`${install.stdout}${install.stderr}`.trim()}`);
  }
  const versions = ['expo', 'expo-router', 'react-native', 'typescript', '@types/react']
    .map((packageName) => `${packageName} ${readInstalledVersion(packageName)}`)
    .join(', ');
  console.log(`1. npm ci installed ${versions}`);
}

function writeExpoEnvDeclaration() {
  const customize = execute(process.execPath, ['node_modules/expo/bin/cli', 'customize', 'tsconfig.json']);
  if (customize.status !== 0) {
    throw new StepFailed(`expo customize tsconfig.json exited with ${customize.status}:\n${customize.stderr.trim()}`);
  }
  let reference;
  try {
    reference = readFileSync('expo-env.d.ts', 'utf8').split(/\r?\n/)[0];
  } catch {
    throw new StepFailed('expo customize tsconfig.json wrote no expo-env.d.ts');
  }
  if (reference !== '/// <reference types="expo/types" />') {
    throw new StepFailed(`expo-env.d.ts starts with ${reference}, not the expo/types reference`);
  }
  console.log(`2. expo customize tsconfig.json wrote expo-env.d.ts: ${reference}`);
}

function printSummary(overlayName, locatedCases, caseDiagnostics, controlDiagnostics) {
  const failingCases = locatedCases.filter((testCase) => caseDiagnostics.has(testCase.line));
  console.log(
    `Summary: on ${overlayName}, ${failingCases.length} of ${locatedCases.length} cases fail with exactOptionalPropertyTypes on, and tsc reports ${controlDiagnostics.length} errors with it off:`
  );
  for (const testCase of locatedCases) {
    const diagnostic = caseDiagnostics.get(testCase.line);
    console.log(
      diagnostic === undefined
        ? `  passes  ${testCase.label} (${screenPath}:${testCase.line})`
        : `  fails   ${testCase.label} (${screenPath}:${testCase.line}, ${diagnostic.code})`
    );
  }
  return failingCases.length;
}

async function main() {
  const overlayArgument = parseArguments(process.argv.slice(2));
  const npmVersion = npm(['--version']).stdout.trim();
  console.log(`System: Node ${process.version}, npm ${npmVersion}, ${os.type()} ${os.release()} ${os.arch()}`);

  installDependencies();
  writeExpoEnvDeclaration();

  const overlay = await readOverlayUnderTest(overlayArgument);
  const installedOverlay = readFileSync(installedOverlayPath);
  const replacesInstalledOverlay = !installedOverlay.equals(overlay.content);
  console.log(
    replacesInstalledOverlay
      ? `3. Overlay under test: ${overlay.name}; it differs from ${installedOverlayPath} (expo ${readInstalledVersion('expo')}) and replaces it for this run`
      : `3. Overlay under test: ${overlay.name}; byte-identical to ${installedOverlayPath} (expo ${readInstalledVersion('expo')})`
  );
  console.log(`4. Its declarations: ${describeDeclarations(overlay.content)}`);

  const locatedCases = locateCases();
  if (replacesInstalledOverlay) {
    writeFileSync(installedOverlayPath, overlay.content);
  }
  try {
    const diagnostics = typeCheck([]);
    console.log(
      `5. tsc --noEmit (strict, exactOptionalPropertyTypes, skipLibCheck from expo/tsconfig.base): ${diagnostics.length} errors`
    );
    for (const diagnostic of diagnostics) {
      console.log(`   ${diagnostic.text}`);
    }
    const controlDiagnostics = typeCheck(['--exactOptionalPropertyTypes', 'false']);
    console.log(`6. tsc --noEmit --exactOptionalPropertyTypes false: ${controlDiagnostics.length} errors`);
    for (const diagnostic of controlDiagnostics) {
      console.log(`   ${diagnostic.text}`);
    }

    const caseLines = new Set(locatedCases.map((testCase) => testCase.line));
    const caseDiagnostics = new Map(
      diagnostics
        .filter((diagnostic) => diagnostic.file === screenPath && caseLines.has(diagnostic.line))
        .map((diagnostic) => [diagnostic.line, diagnostic])
    );
    const otherDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.file !== screenPath || !caseLines.has(diagnostic.line)
    );
    const failingCaseCount = printSummary(overlay.name, locatedCases, caseDiagnostics, controlDiagnostics);
    if (otherDiagnostics.length > 0 || controlDiagnostics.length > 0) {
      console.log(
        `Verdict: type checking fails for another reason (${otherDiagnostics.length} errors outside the cases, ${controlDiagnostics.length} with the option off), exit ${exitCodes.stepFailed}`
      );
      return exitCodes.stepFailed;
    }
    if (failingCaseCount > 0) {
      console.log(`Verdict: the defect shows, exit ${exitCodes.defectShows}`);
      return exitCodes.defectShows;
    }
    console.log(`Verdict: fixed, exit ${exitCodes.fixed}`);
    return exitCodes.fixed;
  } finally {
    if (replacesInstalledOverlay) {
      writeFileSync(installedOverlayPath, installedOverlay);
    }
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.log(error instanceof StepFailed ? `Step failed: ${error.message}` : `Step failed: ${error.stack}`);
  console.log(`Verdict: a step failed before the check, exit ${exitCodes.stepFailed}`);
  process.exitCode = exitCodes.stepFailed;
}
