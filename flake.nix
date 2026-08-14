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
      in
      {
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
