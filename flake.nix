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
            corepack_22

            docker
            kubectl
            kubernetes-helm

            actionlint
          ];

          shellHook = ''
            corepack enable 2>/dev/null || true
            echo "mynotes dev shell — rust $(rustc --version | cut -d' ' -f2), node $(node --version)"
          '';
        };
      }
    );
}
