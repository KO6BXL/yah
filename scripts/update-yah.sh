WORK_DIR="$HOME/.local/share/yah/local-yah"
bun build --compile --outfile "$WORK_DIR/tmp-yah" "$WORK_DIR/src/index.ts"

kill -s SIGUSR1 $(pidof yah)

if $WORK_DIR/tmp-yah; then 
    echo "Success in running tmp-yah"
else 
    yah
fi