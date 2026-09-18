{
  description = "MyNotes — local-first encrypted note taking";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        androidPkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
            android_sdk.accept_license = true;
          };
        };
        androidSdk = androidPkgs.androidenv.composeAndroidPackages {
          platformVersions = [ "36" ];
          buildToolsVersions = [ "37.0.0" ];
          includeNDK = true;
          ndkVersion = "29.0.14206865";
        };
        mcpDepsSrc = pkgs.runCommand "mynotes-mcp-pnpm-deps-src" { } ''
          mkdir -p $out/apps/web $out/apps/android/engine/fixtures $out/packages/mynotes-mcp
          cp ${./package.json} $out/package.json
          cp ${./pnpm-lock.yaml} $out/pnpm-lock.yaml
          cp ${./pnpm-workspace.yaml} $out/pnpm-workspace.yaml
          cp ${./apps/web/package.json} $out/apps/web/package.json
          cp ${./apps/android/engine/fixtures/package.json} $out/apps/android/engine/fixtures/package.json
          cp ${./packages/mynotes-mcp/package.json} $out/packages/mynotes-mcp/package.json
        '';
        mynotes-mcp = pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "mynotes-mcp";
          version = "0.1.0";

          src = pkgs.lib.cleanSourceWith {
            src = ./.;
            filter =
              path: type:
              pkgs.lib.cleanSourceFilter path type
              && !(
                builtins.elem (baseNameOf path) [
                  "node_modules"
                  "dist"
                  ".svelte-kit"
                  "target"
                  "build"
                  "test-results"
                ]
              );
          };

          pnpmDeps = pkgs.pnpm.fetchDeps {
            pname = "mynotes-mcp";
            version = "0.1.0";
            src = mcpDepsSrc;
            fetcherVersion = 4;
            hash = "sha256-ZqmDLcLLQO8z93G524nhJ4hP4SCUMEIMMHc0QUf7WY4=";
          };

          nativeBuildInputs = [
            pkgs.nodejs_22
            pkgs.pnpm
            pkgs.pnpmConfigHook
            pkgs.makeWrapper
          ];

          buildPhase = ''
            runHook preBuild
            pnpm --filter mynotes-mcp build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            pnpm_config_inject_workspace_packages=true \
              pnpm --filter mynotes-mcp deploy --prod --offline $out/lib/mynotes-mcp
            makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/mynotes-mcp \
              --add-flags $out/lib/mynotes-mcp/dist/cli.js
            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "Read-only MCP server for MyNotes sessions";
            homepage = "https://github.com/MattDelac/mynotes";
            license = licenses.mit;
            mainProgram = "mynotes-mcp";
            platforms = platforms.unix;
          };
        });
      in
      {
        packages = {
          inherit mynotes-mcp;
          default = mynotes-mcp;
        };

        devShells.android = androidPkgs.mkShell {
          packages = with androidPkgs; [
            go_1_26
            gcc
            jdk17
            kotlin
            nodejs_22
            zip
            unzip
          ];

          ANDROID_HOME = "${androidSdk.androidsdk}/libexec/android-sdk";
          ANDROID_NDK_HOME = "${androidSdk.ndk-bundle}/libexec/android-sdk/ndk-bundle";
          JAVA_HOME = "${androidPkgs.jdk17}";

          shellHook = ''
            echo "mynotes android dev shell — go $(go version | cut -d' ' -f3), $(java -version 2>&1 | head -1)"
          '';
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            rustc
            cargo
            rustfmt
            clippy
            rust-analyzer
            sqlx-cli

            nodejs_22

            docker
            kubectl
            kubernetes-helm

            actionlint

            gcc
            pkg-config
            openssl
            chromium
          ];

          shellHook = ''
            mkdir -p "$HOME/.local/bin"
            export PATH="$HOME/.local/bin:$PATH"
            corepack enable --install-directory "$HOME/.local/bin"
            export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=${pkgs.chromium}/bin/chromium
            echo "mynotes dev shell — rust $(rustc --version | cut -d' ' -f2), node $(node --version)"
          '';
        };
      }
    );
}
