import * as $rt from "./runtime.ts";

const $tmpl0 = $rt.template("<!--[--><!--]-->");
const $tmpl1 = $rt.template("<!--[--><!--]-->");
const $tmpl2 = $rt.template("<span><!----></span><!--[--><!--]-->");


export function mount($target, $scope, $anchor) {
  const $setup = $rt.openEffectScope();
  try {
    function $mount0($target, $anchor, $scope) {
      const $sink = [];
      const $wasHydrating = $rt.hydrating;
      let $resume = null;
      let $n0, $n1;
      let $roots;
      if ($rt.hydrating) {
        const $forItem = $rt.consumeForItem();
        const $start = $rt.hydrateNode();
        $n0 = $rt.hydrateNode();
        $n1 = $rt.findBlockClose($n0);
        $rt.hydrateSeek($n1 !== null ? $rt.nextSibling($n1) : null);
        $roots = $rt.claimRoots($start, $forItem ? $rt.hydrateNode() : $anchor);
        $resume = $rt.hydrateNode();
      } else {
        const $frag = $tmpl0.content.cloneNode(true);
        $n0 = $rt.firstChild($frag);
        $n1 = $rt.nextSibling($rt.firstChild($frag));
        $roots = Array.from($frag.childNodes);
        $rt.finalize($frag, $target, $anchor);
      }
      $scope["Node"] = (...$args) => ({ mount: ($p, $a) => {
        const $s = Object.create($scope);
        if (typeof $args[1] === "function") $s.children = $args[1];
        Object.defineProperty($s, "entries", { get: () => $args[0].entries, enumerable: true, configurable: true });
        return $mount1($p, $a, $s);
      } });
      {
        const $props = {};
        Object.defineProperty($props, "entries", { get: () => ($scope.tree), enumerable: true, configurable: true });
        $sink.push($rt.component($target, $n0, $n1, "Node", $scope.Node, $props, $rt.emptyChildren, $scope, 1));
      }
      if ($wasHydrating) $rt.hydrateSeek($resume);
      return () => { for (const $d of $sink) $d(); for (const $r of $roots) $rt.remove($r); };
    }
    function $mount1($target, $anchor, $scope) {
      const $sink = [];
      const $wasHydrating = $rt.hydrating;
      let $resume = null;
      let $n0, $n1;
      let $roots;
      if ($rt.hydrating) {
        const $forItem = $rt.consumeForItem();
        const $start = $rt.hydrateNode();
        $n0 = $rt.hydrateNode();
        $n1 = $rt.findBlockClose($n0);
        $rt.hydrateSeek($n1 !== null ? $rt.nextSibling($n1) : null);
        $roots = $rt.claimRoots($start, $forItem ? $rt.hydrateNode() : $anchor);
        $resume = $rt.hydrateNode();
      } else {
        const $frag = $tmpl1.content.cloneNode(true);
        $n0 = $rt.firstChild($frag);
        $n1 = $rt.nextSibling($rt.firstChild($frag));
        $roots = Array.from($frag.childNodes);
        $rt.finalize($frag, $target, $anchor);
      }
      $sink.push($rt.forBlock($target, $n0, $n1, {
        read: () => ($scope.entries),
        isAwait: false,
        keyFor: ($value, $index) => {
        const $k = Object.create($scope);
        $k["entry"] = $value;
        $k["i"] = $index;
        return (($scope) => ($scope.entry[0]))($k);
      },
        createItem: ($p, $end, $value, $index) => {
        const $itemState = $rt.state($value);
        const $indexState = $rt.state($index);
        const $child = Object.create($scope);
        if ($scope.state && $scope.state.forItem) $child.state = $scope.state.forItem($index);
        Object.defineProperty($child, "entry", { get: () => $itemState(), enumerable: true, configurable: true });
        Object.defineProperty($child, "i", { get: () => $indexState(), configurable: true });
        const $dispose = $rt.untrack(() => $mount2($p, $end, $child));
        return {
          update: ($v, $i) => { $itemState.set($v); $indexState.set($i); },
          dispose: () => $dispose(),
        };
      },
        catch: null,
      }));
      if ($wasHydrating) $rt.hydrateSeek($resume);
      return () => { for (const $d of $sink) $d(); for (const $r of $roots) $rt.remove($r); };
    }
    function $mount2($target, $anchor, $scope) {
      const $sink = [];
      const $wasHydrating = $rt.hydrating;
      let $resume = null;
      let $n0, $n0_0, $n1, $n2;
      let $roots;
      if ($rt.hydrating) {
        const $forItem = $rt.consumeForItem();
        const $start = $rt.hydrateNode();
        $n0 = $rt.claimElement($rt.hydrateNode(), "span");
        $rt.hydrateSeek($rt.firstChild($n0));
        $n0_0 = $rt.hydrateValueLeaf();
        $rt.hydrateSeek($rt.nextSibling($n0));
        $n1 = $rt.hydrateNode();
        $n2 = $rt.findBlockClose($n1);
        $rt.hydrateSeek($n2 !== null ? $rt.nextSibling($n2) : null);
        $roots = $rt.claimRoots($start, $forItem ? $rt.hydrateNode() : $anchor);
        $resume = $rt.hydrateNode();
      } else {
        const $frag = $tmpl2.content.cloneNode(true);
        $n0 = $rt.firstChild($frag);
        $n1 = $rt.nextSibling($rt.firstChild($frag));
        $n2 = $rt.nextSibling($rt.nextSibling($rt.firstChild($frag)));
        $n0_0 = $rt.firstChild($n0);
        $roots = Array.from($frag.childNodes);
        $rt.finalize($frag, $target, $anchor);
      }
      $sink.push($rt.interpolate($n0, $n0_0, () => ($scope.entry[0]), 0));
      {
        const $props = {};
        Object.defineProperty($props, "entries", { get: () => ($scope.entry[1]), enumerable: true, configurable: true });
        $sink.push($rt.component($target, $n1, $n2, "Node", $scope.Node, $props, $rt.emptyChildren, $scope, 0));
      }
      if ($wasHydrating) $rt.hydrateSeek($resume);
      return () => { for (const $d of $sink) $d(); for (const $r of $roots) $rt.remove($r); };
    }
    $rt.closeEffectScope($setup);
    const $dispose = $mount0($target, $anchor === undefined ? null : $anchor, $scope);
    return () => { $dispose(); $rt.disposeEffectScope($setup); };
  } finally {
    $rt.closeEffectScope($setup);
  }
}

export function hydrate($container, $scope) {
  $rt.startHydration($container);
  try {
    return mount($container, $scope);
  } catch ($error) {
    $rt.endHydration();
    $rt.warnHydrationMismatch("the page root", $error);
    $container.textContent = "";
    return mount($container, $scope);
  } finally {
    $rt.endHydration();
  }
}

export default (props, childrenFn, $parent, $site) => ({ mount: ($p, $a) => {
  const $s = Object.create($parent ?? null);
  if ($parent && $parent.state && $parent.state.forSite) $s.state = $parent.state.forSite($site);
  $s.props = () => props;
  $s.children = childrenFn;
  return mount($p, $s, $a);
} });
