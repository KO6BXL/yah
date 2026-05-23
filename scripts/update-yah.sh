bun build --compile --outfile tmp-yah ../src/index.ts

if tmp-yah; then 
    echo "Success in running tmp-yah"
else 
    yah
fi