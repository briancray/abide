/*
The tiny inline script the abide-ui SSR stream ships in <head>. For each streamed
`<abide-resolve data-id>` frame it reads the leading `<script type=application/json>`,
registers the resolved value into
`window.__abideResume` (the resume manifest hydration reads) and swaps the resolved
markup into the matching `<!--abide:await:ID-->…<!--/abide:await:ID-->` boundary —
so the pending shell paints instantly and each value lands as it arrives, before
the client bundle even loads. Vanilla and self-contained (no framework runtime),
minified to one line so it inlines cheaply ahead of the document body.
*/
export const SSR_SWAP_SCRIPT =
    "function __abideSwap(){var f=document.querySelector('abide-resolve');while(f){" +
    "var id=f.getAttribute('data-id'),p=f.firstChild,w=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),o=null,c;" +
    "if(p&&p.nodeName==='SCRIPT'){try{(window.__abideResume=window.__abideResume||{})[id]=JSON.parse(p.textContent||'null');}catch(e){}p.remove();}" +
    "while((c=w.nextNode())){if(c.data==='abide:await:'+id){o=c;break;}}" +
    "if(o){var n=o.nextSibling;while(n&&!(n.nodeType===8&&n.data==='/abide:await:'+id)){var x=n.nextSibling;n.remove();n=x;}" +
    "while(f.firstChild){o.parentNode.insertBefore(f.firstChild,n);}}f.remove();f=document.querySelector('abide-resolve');}}"
