import type ts from 'typescript'

export async function getInternalMethodKeys(options: {
  modulePath?: string
  filePath?: string
}) {
  const ts = (await import('typescript')).default
  const path = (await import('path'))

  if (options.filePath) {
    const p = path.parse(options.filePath)
    options.filePath = path.join(p.dir, p.name)
  }

  const sourceMap = {
    '_$$_adapter_forward_$$_.ts': `import '${options.modulePath}'`,
    [options.filePath]: null,
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

  function visit(node: ts.Node) {
    if ((ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      if (node.name.text === 'Internal') {
        node.forEachChild(method => {
          if (ts.isMethodSignature(method) || ts.isMethodDeclaration(method)) {
            result.push(String(method.name?.['text']))
          }
        })
      }
    }
    node.forEachChild(visit)
  }

  const result = []

  for (const sourceFile of prog.getSourceFiles()) {
    ts.forEachChild(sourceFile, visit)
  }

  return result
}
