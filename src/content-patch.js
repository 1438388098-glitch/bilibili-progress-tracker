/** Must run at document_start — before any Bilibili scripts execute.
 *  Forces closed shadow roots to open for custom elements (tag name contains '-')
 *  so the tracker can locate <video> inside B站's player shadow DOM.
 *  Regular HTML elements are not affected. */

var _origAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init) {
  if (init && init.mode === 'closed' && this.tagName.indexOf('-') >= 0) {
    init = Object.assign({}, init, { mode: 'open' });
  }
  return _origAttachShadow.call(this, init);
};
