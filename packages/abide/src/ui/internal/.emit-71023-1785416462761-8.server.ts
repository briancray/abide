import * as $rt from "./serverRuntime.ts";


export async function render($scope) {
  const $setup = $rt.openRenderScope();
  try {
    $rt.closeEffectScope($setup);
    let $out = "";
    $scope["Node"] = async (...$args) => {
      const $s = Object.create($scope);
      if (typeof $args[1] === "function") $s.children = $args[1];
      { const $src = $args[0]; $s["entries"] = $src.entries; }
      let $out = "";
      {
        const $scope = $s;
    $out += "<!--[-->";
    $out += await (async ($scope) => {
      let $out = "";
      let $i = 0;
      const $src = await ($scope.entries);
      for (const $value of ($src ?? [])) {
      const $c = Object.create($scope);
      if ($scope.state && $scope.state.forItem) $c.state = $scope.state.forItem($i);
      $c["entry"] = $value;
      $c["i"] = $i;
      {
        const $scope = $c;
    $out += "<span>";
    { const $v = ($scope.entry[0]); $out += $rt.renderLeaf($rt.isThenable($v) ? await $v : $v); }
    $out += "</span>";
    $out += "<!--[-->";
    {
      const $props = {};
      { const $v = ($scope.entry[1]); $props["entries"] = ($rt.isThenable($v) ? await $v : $v); }
      const $c = $scope.Node;
      if (typeof $c !== "function") throw new Error("<Node> is not a component in scope (expected a render function)");
      const $children = $rt.emptyChildren;
      const $r = await $c($props, $children, $scope, 0);
      $out += $r instanceof $rt.Raw ? $r.value : String($r ?? "");
    }
    $out += "<!--]-->";
      }
      $i++;
      }
      return $out;
    })($scope);
    $out += "<!--]-->";
      }
      return new $rt.Raw($out);
    };
    $out += "<!--[-->";
    {
      const $props = {};
      { const $v = ($scope.tree); $props["entries"] = ($rt.isThenable($v) ? await $v : $v); }
      const $c = $scope.Node;
      if (typeof $c !== "function") throw new Error("<Node> is not a component in scope (expected a render function)");
      const $children = $rt.emptyChildren;
      const $r = await $c($props, $children, $scope, 1);
      $out += $r instanceof $rt.Raw ? $r.value : String($r ?? "");
    }
    $out += "<!--]-->";
    return $out;
  } finally {
    $rt.closeEffectScope($setup);
  }
}

export default async (props, childrenFn, $parent, $site) => {
  const $s = Object.create($parent ?? null);
  if ($parent && $parent.state && $parent.state.forSite) $s.state = $parent.state.forSite($site);
  $s.props = () => props;
  $s.children = childrenFn;
  return new $rt.Raw(await render($s));
};
