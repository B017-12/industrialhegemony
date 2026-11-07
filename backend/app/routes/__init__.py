from . import assets, copilot, labels, scene, search, work_orders, workbook

routers = [assets.router, scene.router, search.router, copilot.router, work_orders.router, workbook.router, labels.router]
