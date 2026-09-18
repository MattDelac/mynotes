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
      in
      {
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
