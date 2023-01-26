import * as vscode from "vscode";
import { objectScriptApi } from "./extension";
import { serverForUri } from "./functions";
import { makeRESTRequest } from "./makeRESTRequest";
import { QueryData } from "./types";

export class AllClassMembersTypeHierarchyProvider implements vscode.TypeHierarchyProvider {

  private members: vscode.TypeHierarchyItem[] = [];


  public prepareTypeHierarchy(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Thenable<vscode.TypeHierarchyItem> {
    return new Promise(async (resolve, reject) => {

      let rootItem: vscode.TypeHierarchyItem | undefined = undefined;
      let className = "";

      let inComment = false;
      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);

        // Skip initial comment block(s)
        if (line.text.match(/\/\*/)) {
          inComment = true;
        }
        if (inComment) {
          if (line.text.match(/\*\//)) {
            inComment = false;
          }
          continue;
        }

        // Discover class name
        const classPat = line.text.match(/^(Class) (%?\b\w+\b(?:\.\b\w+\b)+)/i);
        if (classPat) {

          // Create root symbol (the class itself)
          className = classPat[2];

          rootItem = new vscode.TypeHierarchyItem(
            vscode.SymbolKind.Class,
            className,
            "All Members",
            document.uri,
            line.range,
            line.range
          );
          break;
        }
      }

      if (!rootItem) {
        reject();
      }
      else {
				
				// Query the server to get the metadata of all appropriate class members
				var data: QueryData = {
					query: "SELECT Name, Description, Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
          "FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND Abstract = 0 AND Internal = 0 AND Stub IS NULL AND ((Origin = parent->ID) OR (Origin != parent->ID AND NotInheritable = 0)) UNION ALL %PARALLEL " +
          //"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
          //"FROM %Dictionary.CompiledIndexMethod WHERE parent->parent->ID = ? UNION ALL %PARALLEL " +
          //"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
          //"FROM %Dictionary.CompiledQueryMethod WHERE parent->parent->ID = ? UNION ALL %PARALLEL " +
          //"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
          //"FROM %Dictionary.CompiledPropertyMethod WHERE parent->parent->ID = ? UNION ALL %PARALLEL " +
          //"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
          //"FROM %Dictionary.CompiledConstraintMethod WHERE parent->parent->ID = ? UNION ALL %PARALLEL " +
          "SELECT Name, Description, Origin, NULL AS FormalSpec, RuntimeType AS Type, 'property' AS MemberType, Deprecated " +
          "FROM %Dictionary.CompiledProperty WHERE parent->ID = ? UNION ALL %PARALLEL " +
          "SELECT Name, Description, Origin, NULL AS FormalSpec, Type, 'parameter' AS MemberType, Deprecated " +
          "FROM %Dictionary.CompiledParameter WHERE parent->ID = ?",
					parameters: new Array(3).fill(className)
				};
        const server = await serverForUri(document.uri);
				const respdata = await makeRESTRequest("POST", 1, "/action/query", server, data);
				if (respdata !== undefined && respdata.data.result.content.length > 0) {
					// We got data back

          // TODO for each item, find exact position of member definition in its class UDL
					const range = new vscode.Range(0, 0, 1, 0);
					const selectionRange = new vscode.Range(0, 0, 1, 0);
					for (let memobj of respdata.data.result.content) {
						var item: vscode.TypeHierarchyItem;
						if (memobj.MemberType === "method") {
							item = {
								name: memobj.Name,
								kind: vscode.SymbolKind.Method,
                detail: "",
                uri: objectScriptApi.getUriForDocument(`${memobj.Origin}.cls`),
                range,
                selectionRange
							};
							if (memobj.Type !== "") {
                const type: string = memobj.Type;
                const outType = type.startsWith("%Library.") ? "%" + type.slice(9) : type;
								item.detail = `[${outType}]`;
							}
						}
						else if (memobj.MemberType === "parameter") {
							item = {
								name: memobj.Name,
								kind: vscode.SymbolKind.Constant,
                detail: "",
                uri: objectScriptApi.getUriForDocument(`${memobj.Origin}.cls`),
                range,
                selectionRange
							};
							if (memobj.Type !== "") {
								item.detail = `is ${memobj.Type}`;
							}
						}
						else {
							item = {
								name: memobj.Name,
								kind: vscode.SymbolKind.Property,
                detail: "",
                uri: objectScriptApi.getUriForDocument(`${memobj.Origin}.cls`),
                range,
                selectionRange
							};
							if (memobj.Type !== "") {
								item.detail = `[${memobj.Type}]`;
							}
						}
						if (memobj.Deprecated) {
							item.tags = [vscode.SymbolTag.Deprecated];
						}
						this.members.push(item);
					}
				}

        resolve(rootItem);
      }
    });
  }

  public provideTypeHierarchySubtypes(item: vscode.TypeHierarchyItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TypeHierarchyItem[]> {
    return item.kind === vscode.SymbolKind.Class ? this.members : [];
  }

  public provideTypeHierarchySupertypes(item: vscode.TypeHierarchyItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TypeHierarchyItem[]> {
    return [];
  }
}