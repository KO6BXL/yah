#!/bin/sh

if [[ -z "$HOME" ]]; then
    echo "No home environment"
    return 1
fi
for bin in pnpm bun; do
    if ! command -v "$bin" >/dev/null 2>&1; then
        echo "Required binaries unavailable ($bin), stopping install"
        echo "If you have npm installed, we strongly recommend using an alternative."
        echo "https://pnpm.io"
        echo "https://bun.com"
        return 1
    fi
done

if [[ -z "$DATA_DIR" ]]; then
    DATA_DIR="$HOME/.local/share/yah"
    echo "Creating YAH data dir at $DATA_DIR"
    mkdir -p $DATA_DIR
fi


cd "$DATA_DIR" && git clone https://github.com/KO6BXL/yah.git local-yah
cd "$DATA_DIR" && touch .env
cd "$DATA_DIR" && printf "DATA_DIR=$DATA_DIR\n" >> .env
cd "$DATA_DIR" && printf "hOME=$HOME\n" >> .env

cd "$DATA_DIR/local-yah" && pnpm i
cd "$DATA_DIR/local-yah" && pnpm run build

INSTALL_DIR="$DATA_DIR/local-yah"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo
    echo "Note: $INSTALL_DIR is not in PATH."
    echo "Add this to your shell config:"
    echo
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
