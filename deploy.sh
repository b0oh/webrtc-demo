git branch -D gh-pages
git checkout --orphan gh-pages
git reset
cp copypaste/index.html .
cp copypaste/peer.mjs .
git add index.html
git add peer.mjs
git commit -m "deploy"
git push -f origin gh-pages
git clean  -d  -f .
git checkout master
