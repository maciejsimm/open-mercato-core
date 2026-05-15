import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import {
  arrayLiteral,
  arrowFunction,
  binaryExpression,
  identifier,
  methodCall,
  newExpression,
  propertyAccess,
  returnStatement,
  writeValue,
} from '../ast'
import { emptyArray, moduleEntry, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

export function createReportsDatasetsExtension(): GeneratorExtension {
  const imports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const entries: WriterFunction[] = []

  return {
    id: 'registry.reports-datasets',
    outputFiles: ['reports-datasets.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'reports.ts',
        prefix: 'REPORTS_DATASETS',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'datasets',
              value: namespaceFallback({
                importName,
                members: ['datasets', 'default'],
                fallback: emptyArray(),
                castType: 'Dataset[]',
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const output = renderGeneratedTsSource({
        fileName: 'reports-datasets.generated.ts',
        imports: [
          { namedImports: [{ name: 'Dataset', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/reports/dsl' },
          ...imports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'ReportsDatasetConfigEntry',
            type: '{ moduleId: string; datasets: Dataset[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'ReportsDatasetConfigEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
              {
                name: 'entries',
                initializer: methodCall(identifier('entriesRaw'), 'filter', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: binaryExpression(propertyAccess(propertyAccess(identifier('entry'), 'datasets'), 'length'), '>', 0),
                  }),
                ]),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'reportsDatasetConfigEntries', initializer: identifier('entries') },
              {
                name: 'allReportsDatasets',
                type: 'Dataset[]',
                initializer: methodCall(identifier('entries'), 'flatMap', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(identifier('entry'), 'datasets'),
                  }),
                ]),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'datasetsById',
                initializer: newExpression(identifier('Map'), [
                  methodCall(identifier('allReportsDatasets'), 'map', [
                    arrowFunction({
                      parameters: ['dataset'],
                      body: arrayLiteral(
                        [
                          propertyAccess(identifier('dataset'), 'id'),
                          identifier('dataset'),
                        ],
                        writeValue,
                      ),
                    }),
                  ]),
                ]),
              },
            ],
          })
          sourceFile.addFunction({
            name: 'getReportsDataset',
            isExported: true,
            parameters: [{ name: 'id', type: 'string' }],
            returnType: 'Dataset | undefined',
            statements: [returnStatement(methodCall(identifier('datasetsById'), 'get', [identifier('id')]))],
          })
          sourceFile.addFunction({
            name: 'getReportsDatasetIds',
            isExported: true,
            returnType: 'string[]',
            statements: [
              returnStatement(
                methodCall(identifier('Array'), 'from', [methodCall(identifier('datasetsById'), 'keys', [])]),
              ),
            ],
          })
        },
        generator: 'registry',
      })

      return new Map([['reports-datasets.generated.ts', output]])
    },
  }
}
