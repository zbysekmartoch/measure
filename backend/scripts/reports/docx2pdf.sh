#!/bin/sh

for file in *.docx; do
    [ -e "$file" ] || continue
    soffice \
        --headless \
        --nologo \
        --nofirststartwizard \
        --norestore \
        --convert-to pdf \
        "$file"
done
