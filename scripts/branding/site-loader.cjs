module.exports = function (source) {
  const done = this.async();
  import("./source.mjs")
    .then(({ transformCopy }) => {
      done(null, transformCopy(source, this.resourcePath));
    })
    .catch(done);
};
