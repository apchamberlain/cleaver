var fs   = require('fs');
var Q    = require('q');
var path = require('path');
var md   = require('node-markdown').Markdown;
var yaml = require('js-yaml');
var mustache = require('mustache');
var helper = require('./helper');

function Cleaver(file) {
  this.file = file

  if (!file) throw "!! Please specify a file to parse";

  this.templates = {
    layout: 'layout.mustache'
  };

  this.resources = {
    style: 'default.css',
    navigation: 'navigation.js'
  };

  this.external = {
    document: file
  };

  this.metadata = null;
  this.rawSlices = [];
  this.slides = [];
}


/**
 * Reads the document, loads the appropriate templates, and renders each
 * individual slide.
 *
 * @return {Promise}
 */
Cleaver.prototype._parseDocument = function () {
  var self = this;

  return helper.load(this.external)
    .then(function (data) {
      var slices = self._slice(self.external.loaded.document);
      self.rawSlices = slices;
      self.metadata = yaml.safeLoad(slices[0]);
    })
    .then(self._loadTemplates.bind(self))
    .then(function (data) {
      var slices = self.rawSlices;

      for (var i = 1; i < slices.length; i++) {
        self.slides.push(md(slices[i]));
      }

      // insert an author slide (if necessary) at the end
      if (self.metadata.author) {
        self.slides.push(self._renderAuthorSlide(self.metadata.author));
      }

      // insert an agenda slide (if necessary) as our second slide
      if (self.metadata.agenda) {
        self.slides.splice(1, 0, self._renderAgendaSlide(slices));
      }

      // maybe load an external stylesheet
      if (self.metadata.style) {
        return helper.loadSingle(self.metadata.style)
          .then(function (data) {
            self.external.loaded.style = data;
          })
      }
    });
}


/**
 * Loads the appropriate templates based on metadata.
 * @return {Promise.<Array.<Object>>}
 */
Cleaver.prototype._loadTemplates = function () {
  var promises = [];
  var self = this;

  if (this.metadata.agenda) this.templates.agenda = 'agenda.mustache';
  if (this.metadata.author) this.templates.author = 'author.mustache';

  if (this.metadata.template) {
    promises.push(helper.loadSingle(this.metadata.template)
      .then(function (data) {
        self.templates.loaded.slides = data;
      }));
  } else {
    this.templates.slides = 'default.mustache';
  }

  promises.push(helper.load(this.templates, 'templates'));

  return Q.all(promises);
}


/**
 * Loads the templates, default stylesheet, and any external stylesheets
 * as defined by the user.
 * @return {Promise.<Array.<Object>>}
 */
Cleaver.prototype._loadAssets = function () {
  return Q.all([
    helper.load(this.resources, 'resources')
  ]);
}


/**
 * Renders the slideshow
 */
Cleaver.prototype._renderSlideshow = function () {
  var putControls = this.metadata.controls || (this.metadata.controls === undefined);

  // Render the slides in a template (maybe as specified by the user)
  var slideshow = mustache.render(this.templates.loaded.slides, {
    slides: this.slides,
    controls: putControls,
    // TODO: uglify navigation.js?
    navigation: this.resources.loaded.navigation
  });

  // TODO: handle defaults gracefully
  var title = this.metadata.title || 'Untitled';
  var encoding = this.metadata.encoding || 'utf-8';

  var layoutData = {
    slideshow: slideshow,
    title: title,
    encoding: encoding,
    style: this.resources.loaded.style,
    externalStyle: this.external.loaded.style
  };

  // Render the main layout
  var outputLocation = this.metadata.output || path.basename(this.file, '.md') + '-cleaver.html';

  return helper.save(outputLocation, mustache.render(this.templates.loaded.layout, layoutData));
}


/**
 * Renders the author slide
 * @param {string} authorData The author field of the slideshow metadata
 * @return {string} The formatted author slide
 */
Cleaver.prototype._renderAuthorSlide = function (authorData) {
  return mustache.render(this.templates.loaded.author, authorData);
}

/*
 * Renders the agenda slide
 * @param {string} slices The set of slices that had been loaded from the input file
 * @return {string} The formatted agenda slide
 */
Cleaver.prototype._renderAgendaSlide = function (slices) {
  var titles = [];
  var firstLine, lastTitle, matches;

  for (var i = 1; i < slices.length; i++) {
    firstLine = slices[i].split(/(\n|\r)+/)[0];
    matches = /^(#{3,})\s+(.+)$/.exec(firstLine);

    // Only index non-title slides (begins with 3 ###)
    if (!matches) continue;

    if (lastTitle != matches[2]) {
      lastTitle = matches[2];
      titles.push(lastTitle);
    }
  }

  return mustache.render(this.templates.loaded.agenda, titles);
}

/**
 * Returns a chopped up document that's easy to parse
 * @param {string} The full document
 * @return {Array.<string>} A list of all slides
 */
Cleaver.prototype._slice = function(document) {
  var cuts = document.split(/\r?\n--\r?\n/);
  var slices = [];

  for (var i = 0; i < cuts.length; i++) {
    slices.push(cuts[i].trim());
  }

  return slices;
}


/**
 * Method to run the whole show
 */
Cleaver.prototype.run = function () {
  var self = this;

  Q.all([this._parseDocument(), this._loadAssets()])
    .then(self._renderSlideshow.bind(self))
    .fail(function (err) {
      throw err;
    })
    .done();
}


module.exports = Cleaver;
