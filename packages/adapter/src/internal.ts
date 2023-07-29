import type ts from 'typescript'

export async function getInternalMethodKeys(modulePath: string) {
  const ts = (await import('typescript')).default

  const sourceMap = { 
    '_$$_adapter_forward_$$_.ts': `import '${modulePath}'`
  }

  function createCompilerHost() {
    return {
      getSourceFile,
      getDefaultLibFileName: ts.getDefaultLibFileName,
      writeFile: (fileName, content) => ts.sys.writeFile(fileName, content),
      getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
      getDirectories: path => ts.sys.getDirectories(path),
      getCanonicalFileName: fileName =>
        ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
      getNewLine: () => ts.sys.newLine,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      fileExists,
      readFile,
    };

    function fileExists(fileName: string): boolean {
      return (fileName in sourceMap) || ts.sys.fileExists(fileName);
    }

    function readFile(fileName: string): string | undefined {
      return sourceMap[fileName] || ts.sys.readFile(fileName);
    }

    function getSourceFile(fileName: string, languageVersion: ts.ScriptTarget, onError?: (message: string) => void) {
      const sourceText = readFile(fileName);
      return sourceText !== undefined
        ? ts.createSourceFile(fileName, sourceText, languageVersion)
        : undefined;
    }
  }

  const prog = ts.createProgram({
    rootNames: Object.keys(sourceMap),
    options: ts.getDefaultCompilerOptions(),
    host: createCompilerHost()
  })

  function isNodeExported(node: ts.Node): boolean {
    return (
      (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0 ||
      (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
    );
  }

  function visit(node: ts.Node) {
    if (!isNodeExported(node)) return
    if ((ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      if (node.name.text === 'Internal') {
        node.forEachChild(method => {
          if (ts.isMethodSignature(method) || ts.isMethodDeclaration(method)) {
            result.push(String(method.name?.['text']))
          }
        })
      }
    }
  }

  const result = []

  for (const sourceFile of prog.getSourceFiles()) {
    ts.forEachChild(sourceFile, visit)
  }

  return result
}