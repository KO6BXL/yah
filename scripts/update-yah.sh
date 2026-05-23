bun build --compile --outfile tmp-yah ../src/index.ts

kill -s SIGUSR1 $(pidof yah)

if tmp-yah; then 
    echo "Success in running tmp-yah"
else 
    yah
fi